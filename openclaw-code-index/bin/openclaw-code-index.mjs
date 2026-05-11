#!/usr/bin/env node
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCommand } from '../lib/args.mjs';
import {
  cacheRoot,
  detectOpenClaw,
  ensureOpenClawCheckout,
  formatBootstrap,
  runGitNexusAnalyze,
} from '../lib/openclaw.mjs';
import { run } from '../lib/process.mjs';

const __filename = fileURLToPath(import.meta.url);
const LABEL = 'ai.openclaw-code-index.autoupdate';

const { command, args } = readCommand(process.argv.slice(2));

try {
  if (command === 'help' || args.help) printHelp();
  else if (command === 'status') await status(args);
  else if (command === 'bootstrap') await bootstrap(args);
  else if (command === 'index' || command === 'sync') await index(args);
  else if (command === 'install-autoupdate') await installAutoupdate(args);
  else if (command === 'uninstall-autoupdate') await uninstallAutoupdate();
  else throw new Error(`Unknown command: ${command}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

function printHelp() {
  console.log(`OpenClaw Code Index

Usage:
  openclaw-code-index status --cwd <path> [--json]
  openclaw-code-index bootstrap --cwd <path>
  openclaw-code-index index --source latest-release|latest-beta|main|ref|local [--ref <ref>] [--path <path>]
  openclaw-code-index sync --source latest-release|latest-beta|ref [--ref <ref>]
  openclaw-code-index install-autoupdate --source latest-release|latest-beta [--schedule daily]
  openclaw-code-index uninstall-autoupdate

Defaults:
  --source latest-release
  cache root: ${cacheRoot()}
`);
}

async function status(parsed) {
  const detection = await detectOpenClaw(parsed.cwd || process.cwd());
  const payload = {
    active: detection.isOpenClaw,
    detection,
    cacheRoot: cacheRoot(),
  };
  if (parsed.json) console.log(JSON.stringify(payload, null, 2));
  else {
    console.log(`OpenClaw checkout: ${detection.isOpenClaw ? 'yes' : 'no'}`);
    console.log(`cwd: ${detection.cwd}`);
    console.log(`gitRoot: ${detection.gitRoot || 'unknown'}`);
    console.log(`branch: ${detection.branch || 'unknown'}`);
    console.log(`cacheRoot: ${cacheRoot()}`);
  }
  process.exitCode = 0;
}

async function bootstrap(parsed) {
  const detection = await detectOpenClaw(parsed.cwd || process.cwd());
  const text = formatBootstrap(detection);
  if (detection.isOpenClaw || !parsed.quiet) console.log(text);
  process.exitCode = 0;
}

async function index(parsed) {
  const source = parsed.source || 'latest-release';
  const checkout = await ensureOpenClawCheckout({
    source,
    ref: parsed.ref,
    path: parsed.path,
  });
  const alias = parsed.name || checkout.alias;
  console.log(`OpenClaw source: ${source}`);
  console.log(`OpenClaw ref: ${checkout.ref}`);
  console.log(`OpenClaw path: ${checkout.path}`);
  if (alias) console.log(`GitNexus alias: ${alias}`);

  if (parsed['skip-analyze']) {
    console.log('Skipped GitNexus analyze because --skip-analyze was set.');
    return;
  }

  const result = await runGitNexusAnalyze({
    cwd: checkout.path,
    alias,
    embeddings: Boolean(parsed.embeddings),
    force: Boolean(parsed.force),
    skills: !parsed['skip-skills'],
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.ok ? 0 : result.code || 1;
}

async function installAutoupdate(parsed) {
  const source = parsed.source || 'latest-release';
  if (!['latest-release', 'latest-beta'].includes(source)) {
    throw new Error(
      'install-autoupdate supports --source latest-release or --source latest-beta. Use manual index/sync for main.',
    );
  }
  const schedule = parsed.schedule || 'daily';
  if (schedule !== 'daily') throw new Error('Only --schedule daily is supported in v1.');

  if (platform() === 'darwin') {
    await installLaunchd(source);
  } else if (platform() === 'linux' && (await hasSystemdUser())) {
    await installSystemd(source);
  } else {
    await installCron(source);
  }
}

async function uninstallAutoupdate() {
  if (platform() === 'darwin') await uninstallLaunchd();
  if (platform() === 'linux') await uninstallSystemd();
  await uninstallCron();
}

async function installLaunchd(source) {
  const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
  await mkdir(dirname(plistPath), { recursive: true });
  const gitnexusBin = resolveGitNexusBin();
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    ${gitnexusBin ? `<key>GITNEXUS_BIN</key><string>${gitnexusBin}</string>` : ''}
  </dict>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${__filename}</string>
    <string>sync</string>
    <string>--source</string>
    <string>${source}</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>17</integer></dict>
  <key>StandardOutPath</key><string>${join(cacheRoot(), 'autoupdate.log')}</string>
  <key>StandardErrorPath</key><string>${join(cacheRoot(), 'autoupdate.err.log')}</string>
</dict>
</plist>
`;
  await mkdir(cacheRoot(), { recursive: true });
  await writeFile(plistPath, plist);
  await run('launchctl', ['unload', plistPath], { timeoutMs: 10_000 });
  const loaded = await run('launchctl', ['load', plistPath], { timeoutMs: 10_000 });
  if (!loaded.ok) throw new Error(loaded.stderr || loaded.stdout || 'launchctl load failed');
  console.log(`Installed launchd autoupdate: ${plistPath}`);
}

function resolveGitNexusBin() {
  for (const candidate of ['/opt/homebrew/bin/gitnexus', '/usr/local/bin/gitnexus']) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

async function uninstallLaunchd() {
  const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
  if (existsSync(plistPath)) {
    await run('launchctl', ['unload', plistPath], { timeoutMs: 10_000 });
    await rm(plistPath, { force: true });
    console.log(`Removed launchd autoupdate: ${plistPath}`);
  }
}

async function hasSystemdUser() {
  const result = await run('systemctl', ['--user', 'status'], { timeoutMs: 10_000 });
  return result.ok || /Loaded:/u.test(result.stdout + result.stderr);
}

async function installSystemd(source) {
  const dir = join(homedir(), '.config', 'systemd', 'user');
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `${LABEL}.service`),
    `[Unit]
Description=OpenClaw Code Index refresh

[Service]
Type=oneshot
ExecStart=${process.execPath} ${__filename} sync --source ${source}
`,
  );
  await writeFile(
    join(dir, `${LABEL}.timer`),
    `[Unit]
Description=Daily OpenClaw Code Index refresh

[Timer]
OnCalendar=*-*-* 03:17:00
Persistent=true

[Install]
WantedBy=timers.target
`,
  );
  await run('systemctl', ['--user', 'daemon-reload'], { timeoutMs: 10_000 });
  const enabled = await run('systemctl', ['--user', 'enable', '--now', `${LABEL}.timer`], {
    timeoutMs: 10_000,
  });
  if (!enabled.ok) throw new Error(enabled.stderr || enabled.stdout || 'systemctl enable failed');
  console.log(`Installed systemd user timer: ${LABEL}.timer`);
}

async function uninstallSystemd() {
  const dir = join(homedir(), '.config', 'systemd', 'user');
  await run('systemctl', ['--user', 'disable', '--now', `${LABEL}.timer`], { timeoutMs: 10_000 });
  await rm(join(dir, `${LABEL}.service`), { force: true });
  await rm(join(dir, `${LABEL}.timer`), { force: true });
}

async function installCron(source) {
  const line = `17 3 * * * ${process.execPath} ${__filename} sync --source ${source} >> ${join(cacheRoot(), 'autoupdate.log')} 2>&1 # ${LABEL}`;
  const current = await run('crontab', ['-l'], { timeoutMs: 10_000 });
  const lines = (current.stdout || '')
    .split(/\r?\n/u)
    .filter((value) => value && !value.includes(`# ${LABEL}`));
  lines.push(line);
  const next = `${lines.join('\n')}\n`;
  const child = await run('crontab', ['-'], { timeoutMs: 10_000, input: next });
  if (!child.ok) throw new Error(child.stderr || child.stdout || 'crontab install failed');
  console.log('Installed crontab autoupdate.');
}

async function uninstallCron() {
  const current = await run('crontab', ['-l'], { timeoutMs: 10_000 });
  if (!current.stdout) return;
  const next = `${current.stdout
    .split(/\r?\n/u)
    .filter((line) => !line.includes(`# ${LABEL}`))
    .join('\n')}\n`;
  await writeFile(join(cacheRoot(), '.cron.tmp'), next);
  await run('crontab', [join(cacheRoot(), '.cron.tmp')], { timeoutMs: 10_000 });
  await rm(join(cacheRoot(), '.cron.tmp'), { force: true });
}

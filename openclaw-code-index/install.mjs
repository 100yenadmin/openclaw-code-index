#!/usr/bin/env node
import { access, chmod, cp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = dirname(__filename);
const MONOREPO_ROOT = resolve(ROOT, '..');
const homeRoot = resolve(
  process.env.OPENCLAW_CODE_INDEX_HOME || join(homedir(), '.openclaw-code-index'),
);
const targetRoot = resolve(
  process.argv.includes('--target')
    ? process.argv[process.argv.indexOf('--target') + 1]
    : join(homeRoot, 'installed'),
);

await rm(targetRoot, { recursive: true, force: true });
await mkdir(targetRoot, { recursive: true });

for (const item of [
  'bin',
  'codex-plugin',
  'lib',
  'README.md',
  'RELEASE_NOTES.md',
  'package.json',
  'vendor',
]) {
  if (await exists(join(ROOT, item))) {
    await cp(join(ROOT, item), join(targetRoot, item), { recursive: true });
  }
}

const cliPath = join(targetRoot, 'bin', 'openclaw-code-index.mjs');
const pathBin = resolve(
  process.argv.includes('--bin-dir')
    ? process.argv[process.argv.indexOf('--bin-dir') + 1]
    : join(homeRoot, 'bin'),
);
const pathShim = join(pathBin, 'openclaw-code-index');
await mkdir(pathBin, { recursive: true });
await rm(pathShim, { force: true });
try {
  await symlink(cliPath, pathShim);
} catch {
  await writeFile(
    pathShim,
    `#!/usr/bin/env sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(cliPath)} "$@"\n`,
  );
  await chmod(pathShim, 0o755);
}
const hooksPath = join(targetRoot, 'codex-plugin', 'hooks.json');
const hooks = JSON.parse(await readFile(hooksPath, 'utf8'));
hooks.hooks.SessionStart[0].hooks[0].command = `node ${JSON.stringify(cliPath)} bootstrap --cwd "${'${CODEX_WORKSPACE:-${PWD}}'}" --quiet`;
await writeFile(hooksPath, `${JSON.stringify(hooks, null, 2)}\n`);

const mcpPath = join(targetRoot, 'codex-plugin', '.mcp.json');
const mcp = JSON.parse(await readFile(mcpPath, 'utf8'));
mcp.mcpServers['openclaw-code-index'].command = 'node';
mcp.mcpServers['openclaw-code-index'].args = [cliPath, 'mcp'];
await writeFile(mcpPath, `${JSON.stringify(mcp, null, 2)}\n`);

const vendoredGitNexusRoot = join(targetRoot, 'vendor', 'gitnexus');
const vendoredGitNexusBin = join(vendoredGitNexusRoot, 'dist', 'cli', 'index.js');
if (await exists(vendoredGitNexusBin)) {
  await installVendoredGitNexusDependencies(vendoredGitNexusRoot);
  await writeFile(join(targetRoot, 'gitnexus-bin.txt'), `${vendoredGitNexusBin}\n`);
} else {
  const localGitNexusBin = join(MONOREPO_ROOT, 'gitnexus', 'dist', 'cli', 'index.js');
  if (await exists(localGitNexusBin)) {
    await writeFile(join(targetRoot, 'gitnexus-bin.txt'), `${localGitNexusBin}\n`);
  }
}

console.log('OpenClaw Code Index installed.');
console.log(`Codex Desktop plugin path: ${join(targetRoot, 'codex-plugin')}`);
console.log(`CLI path: ${pathShim}`);
console.log(`Add to PATH if needed: export PATH="${pathBin}:$PATH"`);
console.log('');
console.log('Optional Codex CLI MCP setup:');
console.log(`codex mcp add openclaw-code-index -- node ${JSON.stringify(cliPath)} mcp`);

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function installVendoredGitNexusDependencies(cwd) {
  if (!(await exists(join(cwd, 'package.json')))) return;
  const result = spawnSync(
    'npm',
    ['install', '--omit=dev', '--ignore-scripts', '--package-lock=false'],
    {
      cwd,
      stdio: 'inherit',
      env: {
        ...process.env,
        npm_config_audit: 'false',
        npm_config_fund: 'false',
      },
    },
  );
  if (result.status !== 0) {
    throw new Error('Failed to install vendored GitNexus runtime dependencies.');
  }
  const ladybugInstall = join(cwd, 'node_modules', '@ladybugdb', 'core', 'install.js');
  if (await exists(ladybugInstall)) {
    const native = spawnSync(process.execPath, [ladybugInstall], {
      cwd: join(cwd, 'node_modules', '@ladybugdb', 'core'),
      stdio: 'inherit',
    });
    if (native.status !== 0) {
      throw new Error('Failed to install LadybugDB native runtime.');
    }
  }
}

import { existsSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { run } from './process.mjs';

export const OPENCLAW_REPO = 'https://github.com/openclaw/openclaw.git';
export const OPENCLAW_API = 'https://api.github.com/repos/openclaw/openclaw';

export function cacheRoot() {
  return resolve(process.env.OPENCLAW_CODE_INDEX_HOME || join(homedir(), '.openclaw-code-index'));
}

export function sourceAlias(source, ref) {
  if (source === 'latest-release') return 'openclaw-latest-release';
  if (source === 'main') return 'openclaw-main';
  if (source === 'ref') return `openclaw-${slug(ref || 'ref')}`;
  return null;
}

export function sourceRepoDir(source, ref) {
  const alias = sourceAlias(source, ref) || `openclaw-${slug(basename(ref || 'local'))}`;
  return join(cacheRoot(), 'repos', alias);
}

export function slug(value) {
  return String(value || 'unknown')
    .trim()
    .replace(/^refs\/(heads|tags)\//u, '')
    .replace(/[^A-Za-z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 80);
}

export async function latestOpenClawRelease() {
  const headers = { Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const response = await fetch(`${OPENCLAW_API}/releases/latest`, { headers });
  if (!response.ok) {
    throw new Error(`Failed to resolve latest OpenClaw release: HTTP ${response.status}`);
  }
  const json = await response.json();
  if (!json?.tag_name) throw new Error('Latest OpenClaw release did not include tag_name.');
  return json.tag_name;
}

export async function ensureOpenClawCheckout({ source, ref, path }) {
  if (source === 'local') {
    if (!path) throw new Error('--path is required for --source local.');
    const resolved = resolve(path);
    const detection = await detectOpenClaw(resolved);
    if (!detection.isOpenClaw) throw new Error(`${resolved} is not recognized as OpenClaw.`);
    return { path: resolved, ref: detection.branch || 'local', alias: null, detection };
  }

  const targetRef =
    source === 'latest-release' ? await latestOpenClawRelease() : source === 'main' ? 'main' : ref;
  if (!targetRef) throw new Error('--ref is required for --source ref.');

  const repoDir = sourceRepoDir(source, targetRef);
  await mkdir(join(repoDir, '..'), { recursive: true });

  if (!existsSync(join(repoDir, '.git'))) {
    const clone = await run('git', ['clone', OPENCLAW_REPO, repoDir], {
      timeoutMs: 15 * 60_000,
      maxBytes: 2 * 1024 * 1024,
    });
    if (!clone.ok) throw new Error(clone.stderr || clone.stdout || 'git clone failed');
  }

  const fetch = await run('git', ['fetch', '--tags', 'origin', 'main'], {
    cwd: repoDir,
    timeoutMs: 10 * 60_000,
    maxBytes: 2 * 1024 * 1024,
  });
  if (!fetch.ok) throw new Error(fetch.stderr || fetch.stdout || 'git fetch failed');

  const checkoutTarget = source === 'main' ? 'origin/main' : targetRef;
  const checkout = await checkoutRef(
    repoDir,
    checkoutTarget,
    source === 'ref' ? `origin/${targetRef}` : null,
  );
  if (!checkout.ok) throw new Error(checkout.stderr || checkout.stdout || 'git checkout failed');

  const detection = await detectOpenClaw(repoDir);
  const alias = sourceAlias(source, targetRef);
  return { path: repoDir, ref: targetRef, alias, detection };
}

async function checkoutRef(repoDir, primaryRef, fallbackRef = null) {
  const checkout = await run('git', ['checkout', '--detach', primaryRef], {
    cwd: repoDir,
    timeoutMs: 120_000,
  });
  if (checkout.ok || !fallbackRef) return checkout;
  return run('git', ['checkout', '--detach', fallbackRef], {
    cwd: repoDir,
    timeoutMs: 120_000,
  });
}

export async function detectOpenClaw(cwd = process.cwd()) {
  const startCwd = resolve(cwd);
  const gitRoot = await gitRootFor(startCwd);
  const root = gitRoot || startCwd;
  const packageInfo = readPackageInfo(root);
  const remotes = gitRoot ? await readRemotes(gitRoot) : [];
  const branch = gitRoot ? await readBranch(gitRoot) : null;
  const markers = {
    openclawMjs: existsSync(join(root, 'openclaw.mjs')),
    gatewayDir: existsSync(join(root, 'src', 'gateway')),
    pluginSdkDir: existsSync(join(root, 'src', 'plugin-sdk')),
    extensionsDir: existsSync(join(root, 'extensions')),
  };
  const isOpenClaw = classifyOpenClaw({ packageInfo, remotes, markers });
  return { cwd: startCwd, gitRoot, branch, remotes, package: packageInfo, markers, isOpenClaw };
}

export function formatBootstrap(detection, extra = {}) {
  if (!detection.isOpenClaw) {
    return [
      '<openclaw-code-index>',
      'status: inactive',
      `cwd: ${detection.cwd}`,
      'reason: current directory is not recognized as an OpenClaw checkout',
      '</openclaw-code-index>',
    ].join('\n');
  }

  return [
    '<openclaw-code-index>',
    'status: active',
    `cwd: ${detection.cwd}`,
    `worktree: ${detection.gitRoot || 'unknown'}`,
    `branch: ${detection.branch || 'detached-or-unknown'}`,
    `defaultIndex: ${extra.defaultIndex || 'openclaw-latest-release'}`,
    'contract: use GitNexus query/context/impact before broad OpenClaw source spelunking; verify graph results with file reads; stale indexes are hints, not proof.',
    '</openclaw-code-index>',
  ].join('\n');
}

export async function runGitNexusAnalyze({
  cwd,
  alias,
  embeddings = false,
  force = false,
  skills = true,
}) {
  const command = process.env.GITNEXUS_BIN || 'npx';
  const args = process.env.GITNEXUS_BIN ? ['analyze'] : ['-y', 'gitnexus@latest', 'analyze'];
  if (alias) args.push('--name', alias);
  if (skills) args.push('--skills');
  if (embeddings) args.push('--embeddings');
  if (force) args.push('--force');
  return run(command, args, {
    cwd,
    timeoutMs: 30 * 60_000,
    maxBytes: 4 * 1024 * 1024,
    env: { GITNEXUS_SKIP_OPTIONAL_GRAMMARS: process.env.GITNEXUS_SKIP_OPTIONAL_GRAMMARS || '1' },
  });
}

async function gitRootFor(cwd) {
  const result = await run('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], {
    timeoutMs: 10_000,
  });
  return result.ok ? result.stdout.trim() : null;
}

async function readRemotes(root) {
  const result = await run('git', ['-C', root, 'remote', '-v'], { timeoutMs: 10_000 });
  if (!result.ok) return [];
  return result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function readBranch(root) {
  const result = await run('git', ['-C', root, 'branch', '--show-current'], { timeoutMs: 10_000 });
  return result.ok && result.stdout.trim() ? result.stdout.trim() : null;
}

function readPackageInfo(root) {
  const path = join(root, 'package.json');
  try {
    const json = JSON.parse(readFileSync(path, 'utf8'));
    return {
      path,
      name: json.name || null,
      version: json.version || null,
      repository:
        typeof json.repository === 'string' ? json.repository : json.repository?.url || null,
      homepage: json.homepage || null,
    };
  } catch {
    return null;
  }
}

function classifyOpenClaw({ packageInfo, remotes, markers }) {
  const remoteLooksRight = remotes.some((remote) =>
    remote.split(/\s+/u).some((part) => githubRepoSlug(part) === 'openclaw/openclaw'),
  );
  const repoLooksRight =
    githubRepoSlug(packageInfo?.repository) === 'openclaw/openclaw' ||
    githubRepoSlug(packageInfo?.homepage) === 'openclaw/openclaw';
  const markersLookRight = markers.openclawMjs && markers.gatewayDir && markers.pluginSdkDir;
  return Boolean(
    packageInfo?.name === 'openclaw' && markersLookRight && (remoteLooksRight || repoLooksRight),
  );
}

function githubRepoSlug(value) {
  const text = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^git\+/u, '');
  const ssh = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/u.exec(text);
  if (ssh) return `${ssh[1]}/${ssh[2]}`;
  try {
    const url = new URL(text);
    if (url.hostname !== 'github.com') return null;
    const [owner, repo] = url.pathname.replace(/^\/+|\/+$/gu, '').split('/');
    return owner && repo ? `${owner}/${repo.replace(/\.git$/u, '')}` : null;
  } catch {
    return null;
  }
}

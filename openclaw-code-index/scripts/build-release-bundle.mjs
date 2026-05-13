#!/usr/bin/env node
import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { run } from '../lib/process.mjs';

const root = new URL('..', import.meta.url).pathname;
const monorepoRoot = new URL('../..', import.meta.url).pathname;
const gitnexusRoot = join(monorepoRoot, 'gitnexus');
const gitnexusDist = join(gitnexusRoot, 'dist');
const dist = join(root, 'dist');
const bundleRoot = join(dist, 'bundle', 'openclaw-code-index');
const zipPath = join(dist, 'openclaw-code-index-codex-plugin.zip');

if (!existsSync(join(gitnexusDist, 'cli', 'index.js'))) {
  throw new Error('gitnexus/dist/cli/index.js is missing. Run `npm run build` in gitnexus first.');
}

await rm(dist, { recursive: true, force: true });
await mkdir(bundleRoot, { recursive: true });

for (const item of [
  'bin',
  'codex-plugin',
  'install.mjs',
  'lib',
  'README.md',
  'RELEASE_NOTES.md',
  'package.json',
]) {
  await cp(join(root, item), join(bundleRoot, item), { recursive: true });
}

await mkdir(join(bundleRoot, 'vendor', 'gitnexus'), { recursive: true });
// `scripts` is needed at install/runtime: gitnexus loads
// scripts/install-duckdb-extension.mjs to install the DuckDB VECTOR
// extension; omitting it leaves bundle users on the (much slower)
// exact-scan fallback for semantic queries.
for (const item of ['dist', 'scripts', 'package.json', 'package-lock.json', 'vendor']) {
  const source = join(gitnexusRoot, item);
  if (existsSync(source)) {
    await cp(source, join(bundleRoot, 'vendor', 'gitnexus', item), { recursive: true });
  }
}

const contentChecksums = [];
for (const file of await filesUnder(bundleRoot)) {
  const rel = relative(bundleRoot, file).replaceAll('\\', '/');
  const digest = createHash('sha256').update(readFileSync(file)).digest('hex');
  contentChecksums.push(`${digest}  ${rel}`);
}
await writeFile(join(bundleRoot, 'CHECKSUMS.sha256'), `${contentChecksums.sort().join('\n')}\n`);

const zip = await run('zip', ['-qr', zipPath, 'openclaw-code-index'], {
  cwd: join(dist, 'bundle'),
  timeoutMs: 120_000,
});
if (!zip.ok) {
  console.error(zip.stderr || zip.stdout || 'zip failed');
  process.exit(1);
}

const digest = createHash('sha256').update(readFileSync(zipPath)).digest('hex');
await writeFile(join(dist, 'SHA256SUMS'), `${digest}  openclaw-code-index-codex-plugin.zip\n`);
console.log(zipPath);

async function filesUnder(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

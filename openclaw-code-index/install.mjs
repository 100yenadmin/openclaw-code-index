#!/usr/bin/env node
import { chmod, cp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = dirname(__filename);
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
]) {
  await cp(join(ROOT, item), join(targetRoot, item), { recursive: true });
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

console.log('OpenClaw Code Index installed.');
console.log(`Codex Desktop plugin path: ${join(targetRoot, 'codex-plugin')}`);
console.log(`CLI path: ${pathShim}`);
console.log(`Add to PATH if needed: export PATH="${pathBin}:$PATH"`);
console.log('');
console.log('Optional Codex CLI MCP setup:');
console.log('codex mcp add openclaw-code-index -- npx -y gitnexus@latest mcp');

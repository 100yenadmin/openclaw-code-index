#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const manifest = JSON.parse(
  readFileSync(join(root, 'codex-plugin', '.codex-plugin', 'plugin.json'), 'utf8'),
);
const mcp = JSON.parse(readFileSync(join(root, 'codex-plugin', '.mcp.json'), 'utf8'));
const hooks = JSON.parse(readFileSync(join(root, 'codex-plugin', 'hooks.json'), 'utf8'));

const failures = [];
if (manifest.name !== 'openclaw-code-index')
  failures.push('plugin name must be openclaw-code-index');
if (manifest.interface?.displayName !== 'OpenClaw Code Index')
  failures.push('displayName must be OpenClaw Code Index');
if (manifest.interface?.capabilities?.includes('Write'))
  failures.push('v1 plugin must not declare Write capability');
if (!manifest.interface?.capabilities?.includes('Read'))
  failures.push('plugin must declare Read capability');
if (manifest.mcpServers !== './.mcp.json') failures.push('plugin must reference ./.mcp.json');
if (manifest.hooks !== './hooks.json') failures.push('plugin must reference ./hooks.json');
if (!mcp.mcpServers?.['openclaw-code-index'])
  failures.push('MCP server openclaw-code-index missing');
if (mcp.mcpServers?.['openclaw-code-index']?.command !== 'node')
  failures.push('MCP command must use the OpenClaw wrapper');
if (!JSON.stringify(mcp).includes('openclaw-code-index.mjs'))
  failures.push('MCP must launch openclaw-code-index mcp');
if (!hooks.hooks?.SessionStart) failures.push('SessionStart hook missing');

if (failures.length) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('OpenClaw Code Index plugin metadata is valid.');

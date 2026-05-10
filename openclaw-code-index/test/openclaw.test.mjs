import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectOpenClaw, formatBootstrap, slug, sourceAlias } from '../lib/openclaw.mjs';
import { run } from '../lib/process.mjs';

test('source aliases are stable and public', () => {
  assert.equal(sourceAlias('latest-release'), 'openclaw-latest-release');
  assert.equal(sourceAlias('main'), 'openclaw-main');
  assert.equal(sourceAlias('ref', 'refs/tags/v2026.5.10'), 'openclaw-v2026.5.10');
  assert.equal(slug('feature/foo bar'), 'feature-foo-bar');
});

test('detects OpenClaw from package metadata, markers, and remote', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oci-openclaw-'));
  await run('git', ['init', '-b', 'main'], { cwd: root });
  await run('git', ['remote', 'add', 'origin', 'https://github.com/openclaw/openclaw.git'], {
    cwd: root,
  });
  await mkdir(join(root, 'src', 'gateway'), { recursive: true });
  await mkdir(join(root, 'src', 'plugin-sdk'), { recursive: true });
  await writeFile(join(root, 'openclaw.mjs'), '#!/usr/bin/env node\n');
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'openclaw',
      repository: { type: 'git', url: 'git+https://github.com/openclaw/openclaw.git' },
      homepage: 'https://github.com/openclaw/openclaw#readme',
    }),
  );

  const detection = await detectOpenClaw(root);
  assert.equal(detection.isOpenClaw, true);
  assert.equal(detection.gitRoot, await realpath(root));
  assert.match(formatBootstrap(detection), /status: active/u);
});

test('non-OpenClaw directories are inactive', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oci-other-'));
  await run('git', ['init', '-b', 'main'], { cwd: root });
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'other' }));
  const detection = await detectOpenClaw(root);
  assert.equal(detection.isOpenClaw, false);
  assert.match(formatBootstrap(detection), /status: inactive/u);
});

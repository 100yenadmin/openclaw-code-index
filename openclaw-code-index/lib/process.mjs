import { spawn } from 'node:child_process';

export function run(command, args = [], options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env || {}) },
      stdio: options.input === undefined ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const maxBytes = options.maxBytes ?? 1024 * 1024;
    const timeoutMs = options.timeoutMs ?? 120_000;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 2000).unref();
    }, timeoutMs);
    timer.unref();

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout = `${stdout}${chunk}`.slice(-maxBytes);
    });
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-maxBytes);
    });
    if (options.input !== undefined) {
      child.stdin.end(options.input);
    }
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, code: null, stdout, stderr: error.message, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0 && !timedOut, code, stdout, stderr, timedOut });
    });
  });
}

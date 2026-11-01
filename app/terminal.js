import { spawn } from 'node:child_process';

/**
 * Execute an arbitrary command in a directory and stream output
 */
export function runCommand({ command, cwd, onData, onExit, env = {} }) {
  const child = spawn('bash', ['-c', command], {
    cwd,
    env: { ...process.env, ...env },
  });

  child.stdout.on('data', (chunk) => {
    onData({ type: 'stdout', data: chunk.toString() });
  });

  child.stderr.on('data', (chunk) => {
    onData({ type: 'stderr', data: chunk.toString() });
  });

  child.on('error', (err) => {
    onData({ type: 'error', data: err.message });
  });

  child.on('close', (code) => {
    onExit({ code });
  });

  return child;
}

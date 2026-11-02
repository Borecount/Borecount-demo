import { spawn } from 'node:child_process';

const run = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} failed (${signal ?? code})`));
    });
  });

const waitForApi = async () => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch('http://127.0.0.1:3000/ready');
      if (response.ok) return;
    } catch {
      // API is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Demo API did not become ready within 30 seconds');
};

await run('docker', ['compose', 'up', '-d', 'postgres']);
await run('npm', ['run', 'db:migrate:local']);

const application = spawn('npm', ['run', 'dev:local'], { stdio: 'inherit' });
const shutdown = (signal) => {
  if (!application.killed) application.kill(signal);
};
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

try {
  await waitForApi();
  console.log('\nBorecount demo is ready: http://localhost:5173\n');
  const code = await new Promise((resolve, reject) => {
    application.once('error', reject);
    application.once('exit', (exitCode) => resolve(exitCode ?? 1));
  });
  process.exitCode = code;
} catch (error) {
  shutdown('SIGTERM');
  throw error;
}

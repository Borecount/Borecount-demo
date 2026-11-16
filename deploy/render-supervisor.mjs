import { spawn as nodeSpawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const osEnvironmentKeys = ['PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'TZ', 'SYSTEMROOT', 'WINDIR'];

export function childSpecifications(env = process.env) {
  const apiEnv = { ...env, PORT: '3000', TSX_TSCONFIG_PATH: '/app/apps/api/tsconfig.json' };
  delete apiEnv.PUBLIC_DEMO_CLEANUP_DATABASE_URL;
  const specs = [
    { name: 'api', command: process.execPath, args: ['--import', 'tsx', 'apps/api/src/index.ts'], env: apiEnv },
    { name: 'nginx', command: 'nginx', args: ['-g', 'daemon off;'], env: Object.fromEntries(osEnvironmentKeys.filter(key => env[key] !== undefined).map(key => [key, env[key]])) },
  ];
  if (env.PUBLIC_DEMO === 'true' && (env.PUBLIC_DEMO_CLEANUP_ENABLED ?? 'true') === 'true') {
    if (!env.PUBLIC_DEMO_CLEANUP_DATABASE_URL?.trim()) throw new Error('Public demo cleanup database credential is required');
    const workerEnv = Object.fromEntries(osEnvironmentKeys.filter(key => env[key] !== undefined).map(key => [key, env[key]]));
    Object.assign(workerEnv, { NODE_ENV: 'production', PUBLIC_DEMO: 'true', PUBLIC_DEMO_CLEANUP_ENABLED: 'true', DATABASE_URL: env.PUBLIC_DEMO_CLEANUP_DATABASE_URL });
    specs.push({ name: 'scheduler', command: process.execPath, args: ['scripts/public-demo-scheduler.mjs'], env: workerEnv });
  }
  return specs;
}

// Each child owns a process group, so shutdown also reaches its descendants.
export async function supervise(specs, { spawn = nodeSpawn, shutdownMs = 15000, signals = process, log = message => process.stderr.write(`${message}\n`) } = {}) {
  const children = [];
  let stopping = false;
  let result = 0;
  let shutdownTimer;
  let finish;
  const completed = new Promise(resolve => { finish = resolve; });
  const signalChild = (child, signal) => {
    if (!child.pid) return;
    try { process.kill(-child.pid, signal); } catch (error) {
      if (error.code !== 'ESRCH') log('Unable to signal supervised process');
    }
  };
  const finishIfStopped = () => {
    if (stopping && children.every(item => item.exited)) {
      clearTimeout(shutdownTimer);
      // A leader may exit before its descendants; leave no surviving process group.
      for (const item of children) signalChild(item.child, 'SIGKILL');
      finish(result);
    }
  };
  const stop = (code, signal = 'SIGTERM') => {
    if (stopping) return;
    stopping = true;
    result = code;
    for (const item of children) signalChild(item.child, signal);
    shutdownTimer = setTimeout(() => {
      for (const item of children) signalChild(item.child, 'SIGKILL');
    }, shutdownMs);
    finishIfStopped();
  };
  const onTerm = () => stop(0);
  const onInt = () => stop(0, 'SIGINT');
  signals.on('SIGTERM', onTerm);
  signals.on('SIGINT', onInt);
  try {
    for (const spec of specs) {
      if (stopping) break;
      const child = spawn(spec.command, spec.args, { env: spec.env, stdio: 'inherit', detached: true });
      const item = { child, exited: false };
      children.push(item);
      child.once('error', () => {
        item.exited = !child.pid;
        log(`${spec.name} failed to start`);
        stop(1);
        finishIfStopped();
      });
      child.once('exit', () => {
        item.exited = true;
        // Kill remaining descendants even when their process-group leader exited.
        if (!stopping) {
          log(`${spec.name} exited unexpectedly`);
          stop(1);
        }
        finishIfStopped();
      });
    }
  } catch {
    log('Unable to start supervised process');
    stop(1);
  }
  if (children.length === 0) stop(1);
  try { return await completed; } finally {
    signals.off('SIGTERM', onTerm);
    signals.off('SIGINT', onInt);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await supervise(childSpecifications()); } catch {
    process.stderr.write('Render supervisor configuration failed; verify cleanup configuration\n');
    process.exitCode = 1;
  }
}

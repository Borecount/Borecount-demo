import { safeDatabaseFailure } from './safe-db-error.mjs';

export const RETRY_MS = 300_000;
export const ATTEMPT_MS = 45_000;
export function resetDeadline(status) {
  if (status?.purpose !== 'borecount-disposable-public-demo') {
    throw Object.assign(new Error(), { code: 'MISSING_MARKER' });
  }
  const deadline = typeof status.next_reset_at === 'string' ? Date.parse(status.next_reset_at) : NaN;
  if (!Number.isFinite(deadline)) throw Object.assign(new Error(), { code: 'INVALID_STATUS' });
  return deadline;
}

/** One connection per bounded check; one timer while sleeping; DB owns all deletion decisions. */
export function createCleanupScheduler({ connect, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, log = console.log }) {
  let stopped = false, started = false, timer, active, connection, closeConnection;
  const emit = (event, fields = {}) => log(JSON.stringify({ event, at: new Date(now()).toISOString(), ...fields }));
  function schedule(delay, deadline) {
    if (stopped) return;
    clearTimer(timer);
    timer = setTimer(() => { timer = undefined; void run(); }, Math.min(Math.max(0, delay), 2_147_483_647));
    emit(deadline === undefined ? 'sandbox_cleanup_retry' : 'sandbox_cleanup_scheduled', {
      scheduled_at: new Date(now() + delay).toISOString(),
      ...(deadline === undefined ? {} : { next_reset_at: new Date(deadline).toISOString() }),
    });
  }
  async function check(signal) {
    connection = connect();
    let closing;
    closeConnection = () => closing ??= Promise.resolve().then(() => connection.close());
    const deadline = resetDeadline(await connection.status());
    if (signal.aborted || stopped) return;
    if (deadline > now()) return deadline;
    emit('sandbox_cleanup_attempt', { next_reset_at: new Date(deadline).toISOString(), lateness_ms: Math.max(0, now() - deadline) });
    let reset, failure;
    try { reset = await connection.cleanup(); } catch (error) { failure = error; }
    if (signal.aborted || stopped) return;
    // Even an unsuccessful invocation can race a successful external worker.
    const next = resetDeadline(await connection.status());
    if (signal.aborted || stopped) return;
    if (failure) emit('sandbox_cleanup_failed', safeDatabaseFailure(failure));
    if (reset === true) emit('sandbox_database_reset', { next_reset_at: new Date(next).toISOString() });
    else emit('sandbox_cleanup_checked', { next_reset_at: new Date(next).toISOString() });
    return next > now() ? next : undefined;
  }
  function run() {
    if (stopped || active) return active;
    active = (async () => {
      const controller = new AbortController();
      let watchdog, next;
      try {
        next = await Promise.race([
          check(controller.signal),
          new Promise((_, reject) => {
            watchdog = setTimer(() => {
              controller.abort();
              void closeConnection?.().catch(() => {});
              reject(Object.assign(new Error(), { code: 'DEADLINE_EXCEEDED' }));
            }, ATTEMPT_MS);
          }),
        ]);
      } catch (error) { if (!stopped) emit('sandbox_cleanup_failed', safeDatabaseFailure(error)); }
      finally {
        controller.abort();
        clearTimer(watchdog);
        try { await closeConnection?.(); } catch (error) {
          next = undefined;
          if (!stopped) emit('sandbox_cleanup_failed', safeDatabaseFailure(error));
        }
        connection = closeConnection = undefined;
      }
      if (!stopped) schedule(next === undefined ? RETRY_MS : next - now(), next);
    })().finally(() => { active = undefined; });
    return active;
  }
  return {
    start() {
      if (started || stopped) return active;
      started = true;
      emit('sandbox_cleanup_started');
      return run();
    },
    async stop() {
      if (stopped) return active;
      stopped = true;
      clearTimer(timer);
      await closeConnection?.().catch(() => {});
      await active;
      emit('sandbox_cleanup_shutdown');
    },
  };
}

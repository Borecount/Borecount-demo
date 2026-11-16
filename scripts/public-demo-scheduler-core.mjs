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
export function databaseTime(status) {
  const time = typeof status?.database_now === 'string' ? Date.parse(status.database_now) : NaN;
  if (!Number.isFinite(time)) throw Object.assign(new Error(), { code: 'INVALID_STATUS' });
  return time;
}

/** One connection per bounded check; one timer while sleeping; DB owns all deletion decisions. */
export function createCleanupScheduler({ connect, now = Date.now, monotonicNow = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout, log = console.log }) {
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
  async function readTiming() {
    const status = await connection.status();
    const deadline = resetDeadline(status);
    const databaseNow = databaseTime(status);
    // Relative Node timers use elapsed time; wall-clock offsets/jumps must not move the run.
    return { deadline, databaseNow, wakeAt: monotonicNow() + deadline - databaseNow };
  }
  async function check(signal) {
    connection = connect();
    let closing;
    closeConnection = () => closing ??= Promise.resolve().then(() => connection.close());
    const timing = await readTiming();
    if (signal.aborted || stopped) return;
    if (timing.deadline > timing.databaseNow) return timing;
    emit('sandbox_cleanup_attempt', {
      next_reset_at: new Date(timing.deadline).toISOString(),
      database_at: new Date(timing.databaseNow).toISOString(),
      lateness_ms: Math.max(0, timing.databaseNow - timing.deadline),
    });
    let reset;
    try { reset = await connection.cleanup(); } catch (error) {
      if (!signal.aborted && !stopped) emit('sandbox_cleanup_failed', { ...safeDatabaseFailure(error), operation: 'cleanup' });
    }
    if (signal.aborted || stopped) return;
    // Even an unsuccessful invocation can race a successful external worker.
    const next = await readTiming();
    if (signal.aborted || stopped) return;
    if (reset === true) emit('sandbox_database_reset', { next_reset_at: new Date(next.deadline).toISOString() });
    else emit('sandbox_cleanup_checked', { next_reset_at: new Date(next.deadline).toISOString() });
    return next.deadline > next.databaseNow ? next : undefined;
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
      if (!stopped) schedule(next === undefined ? RETRY_MS : next.wakeAt - monotonicNow(), next?.deadline);
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

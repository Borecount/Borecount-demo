import assert from 'node:assert/strict';
import test from 'node:test';
import { createCleanupScheduler, RETRY_MS, ATTEMPT_MS } from '../../scripts/public-demo-scheduler-core.mjs';
import { validateCleanupUrl } from '../../scripts/public-cleanup-db.mjs';

const marker = 'borecount-disposable-public-demo';
const status = (deadline, purpose = marker, databaseNow) => ({
  purpose, next_reset_at: new Date(deadline).toISOString(),
  ...(databaseNow === undefined ? {} : { database_now: new Date(databaseNow).toISOString() }),
});

function harness(initial = 0) {
  let wallTime = initial, monotonicTime = initial, nextId = 1;
  const timers = new Map();
  const logs = [];
  const setTimer = (fn, delay) => {
    const id = nextId++;
    timers.set(id, { fn, at: monotonicTime + delay });
    return id;
  };
  const clearTimer = id => timers.delete(id);
  const advance = async ms => {
    wallTime += ms;
    monotonicTime += ms;
    for (;;) {
      const entry = [...timers].find(([, t]) => t.at <= monotonicTime);
      if (!entry) break;
      const [id, timer] = entry;
      timers.delete(id);
      timer.fn();
      await flush();
    }
    await flush();
  };
  const flush = async () => {
    for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve));
  };
  const scheduler = connect => createCleanupScheduler({
    connect: () => {
      const connection = connect();
      const readStatus = connection.status.bind(connection);
      return { ...connection, status: async () => {
        const value = await readStatus();
        if (value && typeof value === 'object' && !Object.hasOwn(value, 'database_now')) {
          return { ...value, database_now: new Date(monotonicTime).toISOString() };
        }
        return value;
      } };
    },
    now: () => wallTime, monotonicNow: () => monotonicTime, setTimer, clearTimer,
    log: line => logs.push(JSON.parse(line)),
  });
  return {
    scheduler, logs, timers, advance, flush,
    now: () => wallTime, monotonic: () => monotonicTime,
    jumpWall: ms => { wallTime += ms; },
    setMonotonic: value => { monotonicTime = value; },
  };
}

test('future deadline sleeps on one exact timer, closes the check connection, and does not poll', async () => {
  const h = harness(1_000_000), deadline = h.now() + 24 * 60 * 60_000;
  let connections = 0, closes = 0;
  const scheduler = h.scheduler(() => {
    connections++;
    return { status: async () => status(deadline), cleanup: async () => assert.fail('not due'), close: async () => { closes++; } };
  });
  await scheduler.start();
  assert.equal(connections, 1);
  assert.equal(closes, 1);
  assert.equal([...h.timers.values()].length, 1);
  assert.equal([...h.timers.values()][0].at, deadline);
  await h.advance(24 * 60 * 60_000 - 1);
  assert.equal(connections, 1);
  await h.advance(1);
  assert.equal(connections, 2);
  await scheduler.stop();
});

test('a due startup checks immediately, cleans up, and persists the returned next deadline', async () => {
  const h = harness(2_000_000), next = h.now() + 120_000;
  const statuses = [status(h.now() - 1), status(next)];
  let calls = 0, closes = 0;
  const scheduler = h.scheduler(() => ({
    status: async () => statuses.shift(), cleanup: async () => { calls++; return true; },
    close: async () => { closes++; },
  }));
  await scheduler.start();
  assert.equal(calls, 1);
  assert.equal(closes, 1);
  assert.ok(h.logs.some(x => x.event === 'sandbox_database_reset' && x.next_reset_at === new Date(next).toISOString()));
  assert.equal([...h.timers.values()][0].at, next);
  await scheduler.stop();
});

test('a restarted scheduler preserves the database deadline instead of restarting its interval', async () => {
  const h = harness(3_000_000), deadline = h.now() + 37_000;
  let checks = 0;
  const scheduler = h.scheduler(() => ({ status: async () => { checks++; return status(deadline); }, cleanup: async () => false, close: async () => {} }));
  await scheduler.start();
  assert.equal(checks, 1);
  assert.equal([...h.timers.values()][0].at, deadline);
  await scheduler.stop();
});

for (const kind of ['false result', 'failed cleanup']) {
  test(`${kind} with an overdue unchanged deadline retries after five minutes`, async () => {
    const h = harness(4_000_000), overdue = h.now() - 1;
    let cleanups = 0;
    const scheduler = h.scheduler(() => ({
      status: async () => status(overdue),
      cleanup: async () => { cleanups++; if (kind === 'failed cleanup') throw Object.assign(new Error('secret'), { code: 'ECONNRESET' }); return false; },
      close: async () => {},
    }));
    await scheduler.start();
    assert.equal(cleanups, 1);
    assert.equal([...h.timers.values()][0].at, h.now() + RETRY_MS);
    await scheduler.stop();
  });
}

test('if another worker advances the deadline after an error, schedule that future deadline', async () => {
  const h = harness(5_000_000), future = h.now() + 80_000;
  let reads = 0;
  const scheduler = h.scheduler(() => ({
    status: async () => ++reads === 1 ? status(h.now() - 10) : status(future),
    cleanup: async () => { throw Object.assign(new Error('secret'), { code: 'ECONNRESET' }); }, close: async () => {},
  }));
  await scheduler.start();
  assert.equal(reads, 2);
  assert.equal([...h.timers.values()][0].at, future);
  await scheduler.stop();
});

test('a false cleanup result still observes another worker advancing the deadline', async () => {
  const h = harness(5_500_000), future = h.now() + 65_000;
  let reads = 0, cleanups = 0;
  const scheduler = h.scheduler(() => ({
    status: async () => ++reads === 1 ? status(h.now() - 1) : status(future),
    cleanup: async () => { cleanups++; return false; }, close: async () => {},
  }));
  await scheduler.start();
  assert.equal(reads, 2);
  assert.equal(cleanups, 1);
  assert.equal([...h.timers.values()][0].at, future);
  await scheduler.stop();
});

test('a status connection error closes the connection and retries after five minutes', async () => {
  const h = harness(5_750_000);
  let closes = 0;
  const scheduler = h.scheduler(() => ({
    status: async () => { throw Object.assign(new Error('private db detail'), { code: 'ECONNRESET' }); },
    cleanup: async () => assert.fail('cleanup must not run without status'), close: async () => { closes++; },
  }));
  await scheduler.start();
  assert.equal(closes, 1);
  assert.equal([...h.timers.values()][0].at, h.now() + RETRY_MS);
  assert.ok(h.logs.some(x => x.event === 'sandbox_cleanup_failed' && x.code === 'ECONNRESET'));
  await scheduler.stop();
});

test('an early timer caused by clock skew rechecks status and never cleans early', async () => {
  const h = harness(6_000_000), deadline = h.now() + 50_000;
  let cleanups = 0, checks = 0;
  const scheduler = h.scheduler(() => ({ status: async () => { checks++; return status(deadline); }, cleanup: async () => { cleanups++; return true; }, close: async () => {} }));
  await scheduler.start();
  const [id, timer] = [...h.timers][0];
  h.timers.delete(id);
  // Keep the fake clock behind the timer callback to model a premature wakeup.
  timer.fn();
  await h.flush();
  assert.equal(checks, 2);
  assert.equal(cleanups, 0);
  assert.equal([...h.timers.values()][0].at, deadline);
  await scheduler.stop();
});

for (const offset of [-6 * 60 * 60_000, 6 * 60 * 60_000]) {
  test(`container wall clock ${offset < 0 ? 'behind' : 'ahead'} by hours does not change DB deadline`, async () => {
    const h = harness(6_250_000), databaseNow = h.monotonic(), deadline = databaseNow + 40_000;
    let checks = 0, cleanups = 0;
    h.jumpWall(offset);
    const scheduler = h.scheduler(() => ({
      status: async () => { checks++; return status(deadline, marker, databaseNow); },
      cleanup: async () => { cleanups++; return true; }, close: async () => {},
    }));
    await scheduler.start();
    assert.equal(cleanups, 0);
    assert.equal(checks, 1);
    assert.equal([...h.timers.values()][0].at, databaseNow + 40_000);
    await scheduler.stop();

    const dueHarness = harness(6_500_000), dueDbNow = dueHarness.monotonic();
    dueHarness.jumpWall(-offset);
    let dueCleanups = 0;
    const dueScheduler = dueHarness.scheduler(() => ({
      status: async () => status(dueDbNow - 1, marker, dueDbNow),
      cleanup: async () => { dueCleanups++; return true; }, close: async () => {},
    }));
    await dueScheduler.start();
    assert.equal(dueCleanups, 1, 'DB due state controls cleanup despite wall clock offset');
    await dueScheduler.stop();
  });
}

test('wall jumps during the DB check and sleep do not cause polling or shift the monotonic deadline', async () => {
  const h = harness(6_750_000), databaseNow = h.monotonic(), deadline = databaseNow + 70_000;
  let checks = 0, closes = 0;
  const scheduler = h.scheduler(() => ({
    status: async () => { checks++; return status(deadline, marker, databaseNow); },
    cleanup: async () => assert.fail('deadline is in the future'),
    close: async () => { closes++; h.jumpWall(8 * 60 * 60_000); },
  }));
  await scheduler.start();
  assert.equal(checks, 1);
  assert.equal(closes, 1);
  assert.equal([...h.timers.values()][0].at, databaseNow + 70_000);
  h.jumpWall(-16 * 60 * 60_000);
  await h.advance(69_999);
  assert.equal(checks, 1, 'no intermediate DB polling');
  assert.equal([...h.timers.values()][0].at, deadline);
  await h.advance(1);
  assert.equal(checks, 2, 'status is read only when the monotonic timer reaches the DB interval');
  await scheduler.stop();
});

test('missing or invalid database time performs no cleanup and retries safely', async t => {
  for (const [label, databaseNow] of [['missing', undefined], ['invalid', 'not-a-date']]) {
    await t.test(label, async () => {
      const h = harness(6_900_000); let cleanups = 0;
      const badStatus = { ...status(h.now() - 1) };
      badStatus.database_now = databaseNow;
      const scheduler = h.scheduler(() => ({
        status: async () => badStatus,
        cleanup: async () => { cleanups++; return true; }, close: async () => {},
      }));
      await scheduler.start();
      assert.equal(cleanups, 0);
      assert.equal([...h.timers.values()][0].at, h.monotonic() + RETRY_MS);
      assert.ok(h.logs.some(x => x.event === 'sandbox_cleanup_failed' && x.code === 'INVALID_STATUS'));
      await scheduler.stop();
    });
  }
});

test('cleanup error is logged even when the follow-up status read also fails', async () => {
  const h = harness(6_950_000), due = h.monotonic() - 1;
  let reads = 0;
  const scheduler = h.scheduler(() => ({
    status: async () => {
      if (++reads === 1) return status(due, marker, due + 1);
      throw Object.assign(new Error('secondary secret'), { code: 'ETIMEDOUT' });
    },
    cleanup: async () => { throw Object.assign(new Error('cleanup secret'), { code: 'ECONNRESET' }); },
    close: async () => {},
  }));
  await scheduler.start();
  const failures = h.logs.filter(x => x.event === 'sandbox_cleanup_failed');
  assert.deepEqual(failures.map(x => [x.code, x.category]), [
    ['ECONNRESET', 'connection'], ['ETIMEDOUT', 'connection_timeout'],
  ]);
  const output = JSON.stringify(failures);
  assert.equal(output.includes('secret'), false);
  assert.equal([...h.timers.values()][0].at, h.monotonic() + RETRY_MS);
  await scheduler.stop();
});

test('invalid marker or date is safe, performs no cleanup, and retries', async t => {
  for (const [label, bad] of [['marker', status(9_000_000, 'wrong-purpose')], ['date', { purpose: marker, next_reset_at: 'not-a-date' }]]) {
    await t.test(label, async () => {
      const h = harness(7_000_000); let cleanups = 0;
      const scheduler = h.scheduler(() => ({ status: async () => bad, cleanup: async () => { cleanups++; return true; }, close: async () => {} }));
      await scheduler.start();
      assert.equal(cleanups, 0);
      assert.equal([...h.timers.values()][0].at, h.now() + RETRY_MS);
      assert.ok(h.logs.some(x => x.event === 'sandbox_cleanup_failed'));
      await scheduler.stop();
    });
  }
});

test('45 second attempt watchdog closes a stuck connection and retries without overlap', async () => {
  const h = harness(8_000_000);
  let closes = 0, connections = 0, cleanups = 0;
  let resolveStatus;
  const scheduler = h.scheduler(() => {
    connections++;
    return {
      status: () => new Promise(resolve => { resolveStatus = resolve; }),
      cleanup: async () => { cleanups++; return true; },
      close: async () => { closes++; resolveStatus?.(status(h.now() + 500_000)); },
    };
  });
  const first = scheduler.start();
  assert.equal([...h.timers.values()].some(x => x.at === h.now() + ATTEMPT_MS), true);
  await h.advance(ATTEMPT_MS);
  await first;
  assert.equal(connections, 1);
  assert.equal(closes, 1);
  assert.equal(cleanups, 0);
  assert.equal([...h.timers.values()][0].at, h.now() + RETRY_MS);
  await scheduler.stop();
});

test('shutdown clears the scheduled timer, closes the active connection, and prevents cleanup', async () => {
  const h = harness(9_000_000);
  let closes = 0, cleanups = 0, resolveStatus;
  const scheduler = h.scheduler(() => ({
    status: () => new Promise(resolve => { resolveStatus = resolve; }),
    cleanup: async () => { cleanups++; return true; },
    close: async () => { closes++; resolveStatus?.(status(h.now() - 1)); },
  }));
  const start = scheduler.start();
  await h.flush();
  await scheduler.stop();
  await start;
  assert.equal(closes, 1);
  assert.equal(cleanups, 0);
  assert.equal(h.timers.size, 0);
  assert.ok(h.logs.some(x => x.event === 'sandbox_cleanup_shutdown'));
});

test('shutdown while idle clears the one scheduled timer', async () => {
  const h = harness(9_500_000), deadline = h.now() + 100_000;
  let connections = 0;
  const scheduler = h.scheduler(() => {
    connections++;
    return { status: async () => status(deadline), cleanup: async () => false, close: async () => {} };
  });
  await scheduler.start();
  assert.equal(h.timers.size, 1);
  await scheduler.stop();
  assert.equal(h.timers.size, 0);
  await h.advance(deadline - h.now());
  assert.equal(connections, 1);
});

test('cleanup URL guard rejects unsafe endpoints and scheduler logs never expose credentials or raw errors', async () => {
  const good = validateCleanupUrl('postgresql://borecount_demo_cleanup:secret@db.example/luxledger_demo_hosted?sslmode=verify-full');
  assert.equal(good.hostname, 'db.example');
  for (const url of [
    'https://borecount_demo_cleanup:secret@db.example/luxledger_demo_hosted?sslmode=verify-full',
    'postgres://other:secret@db.example/luxledger_demo_hosted?sslmode=verify-full',
    'postgres://borecount_demo_cleanup:secret@db-pooler.example/luxledger_demo_hosted?sslmode=verify-full',
    'postgres://borecount_demo_cleanup:secret@db.example/other?sslmode=verify-full',
    'postgres://borecount_demo_cleanup:secret@db.example/luxledger_demo_hosted?sslmode=require',
    'postgres://borecount_demo_cleanup:secret@db.example/luxledger_demo_hosted?sslmode=verify-full&statement_timeout=0',
    'postgres://borecount_demo_cleanup:secret@db.example/luxledger_demo_hosted?sslmode=verify-full&channel_binding=require',
    'postgres://borecount_demo_cleanup:secret@db.example/luxledger_demo_hosted?sslmode=verify-full&channel_binding=prefer',
    'postgres://borecount_demo_cleanup:secret@db.example/luxledger_demo_hosted?sslmode=verify-full&channel_binding=disable',
  ]) assert.throws(() => validateCleanupUrl(url), { code: 'CONFIGURATION_INVALID' });

  const h = harness(10_000_000), secret = 'postgresql://user:password@host/db SELECT secret';
  const scheduler = h.scheduler(() => ({ status: async () => status(h.now() - 1), cleanup: async () => { throw Object.assign(new Error(secret), { code: 'ECONNRESET', detail: secret, query: secret }); }, close: async () => {} }));
  await scheduler.start();
  const output = JSON.stringify(h.logs);
  assert.equal(output.includes(secret), false);
  assert.equal(output.includes('password'), false);
  assert.ok(h.logs.some(x => x.event === 'sandbox_cleanup_failed' && x.code === 'ECONNRESET' && x.category === 'connection'));
  await scheduler.stop();
});

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  allPages,
  query,
  request,
  setAccessToken,
  toMinor,
  type Account,
  type Balance,
  type DemoMode,
  type DemoRequest,
  type Entry,
  type Hold,
  type Json,
  type Ledger,
  type Page,
  type Session,
  type Transaction,
} from '../api';
import { asObject, errorMessage, formatJson, initialIds, newReference } from '../workspace-utils';

export function useSandbox(mode: DemoMode) {
  const [session, setSession] = useState<Session | null>(null);

  // Loaded entities and selections survive integration-mode switches.
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [ledger, setLedger] = useState('');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [txCursor, setTxCursor] = useState<string | null>(null);
  const [txFilter, setTxFilter] = useState('');
  const [holds, setHolds] = useState<Hold[]>([]);
  const [holdCursor, setHoldCursor] = useState<string | null>(null);
  const [holdState, setHoldState] = useState<Hold['state'] | ''>('');
  const [ids, setIds] = useState(initialIds);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [balance, setBalance] = useState<Balance | null>(null);
  const [reconciliationHistoryRevision, setReconciliationHistoryRevision] = useState(0);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [txEntries, setTxEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [from, setFrom] = useState('wallet:alice');
  const [to, setTo] = useState('wallet:bob');
  const [amount, setAmount] = useState('25.00');
  const [reference, setReference] = useState(newReference);
  const [expirationAsOf, setExpirationAsOf] = useState('');
  const [beforeAfter, setBeforeAfter] = useState<{ before: Account[]; after: Account[] } | null>(
    null,
  );

  const [lastSent, setLastSent] = useState<DemoRequest | null>(null);
  // Version guards prevent late reads from overwriting newer ledger/mode state.
  const initialized = useRef(false);
  const executionVersion = useRef(0);
  const refreshVersion = useRef(0);
  const inspectionVersion = useRef(0);
  const balanceController = useRef<AbortController | null>(null);
  const refreshRef = useRef<() => Promise<Account[] | undefined>>(async () => undefined);
  const currency =
    accounts[0]?.currency ??
    (ledgers.find((l) => l.id === ledger)?.name.startsWith('EUR') ? 'EUR' : 'USD');
  const scale = session?.assets.find((a) => a.code === currency)?.scale ?? 2;
  const holdWhere = JSON.stringify({
    ledger_id: { eq: ledger },
    ...(holdState ? { state: { eq: holdState } } : {}),
  });
  const bootstrap = useCallback(async (fresh: boolean) => {
    setBusy(true);
    setError(null);
    if (fresh) {
      inspectionVersion.current++;
      balanceController.current?.abort();
      refreshVersion.current++;
    }
    try {
      let activeSession: Session;
      if (fresh) activeSession = await request<Session>({ method: 'POST', path: '/demo/session' });
      else {
        try {
          activeSession = await request<Session>({ method: 'GET', path: '/demo/session' });
        } catch (e) {
          if (e instanceof Error && 'status' in e && e.status === 401)
            activeSession = await request<Session>({ method: 'POST', path: '/demo/session' });
          else throw e;
        }
      }
      setSelectedAccount('');
      setBalance(null);
      setAccounts([]);
      setAccessToken(activeSession.access_token);
      setSession(activeSession);
      setIds(initialIds);
      setExpirationAsOf('');
      setSelectedTx(null);
      setTxEntries([]);
      setBeforeAfter(null);
      setLastSent(null);
      const availableLedgers = await allPages<Ledger>('/v1/ledgers?limit=200');
      setLedgers(availableLedgers);
      setLedger(availableLedgers[0]?.id ?? '');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void bootstrap(false);
  }, [bootstrap]);
  useEffect(() => {
    if (!session) return;
    const interval = window.setInterval(
      () => {
        void request<Session>({ method: 'GET', path: '/demo/session' })
          .then((activeSession) => {
            setAccessToken(activeSession.access_token);
            setSession(activeSession);
          })
          .catch((e) => setError(errorMessage(e)));
      },
      Math.max(10000, (session.expires_in - 60) * 1000),
    );
    return () => window.clearInterval(interval);
  }, [session]);

  // The monotonically increasing version also guards reads that finish just
  // before their AbortController is cancelled during a ledger or mode change.
  const refresh = useCallback(async () => {
    if (!ledger) return;
    const version = ++refreshVersion.current;
    let nextAccounts: Account[];
    let transactionPage: Page<Transaction>;
    let holdPage: Page<Hold>;
    try {
      [nextAccounts, transactionPage, holdPage] = await Promise.all([
        allPages<Account>(query('/v1/accounts', { ledger_id: ledger, limit: 200 })),
        request<Page<Transaction>>({
          method: 'GET',
          path: query('/v1/transactions', {
            ledger_id: ledger,
            limit: 10,
            ...(txFilter ? { where: formatJson({ reference: { eq: txFilter } }) } : {}),
          }),
        }),
        request<Page<Hold>>({ method: 'GET', path: query('/v1/holds', { where: holdWhere }) }),
      ]);
    } catch (e) {
      if (version !== refreshVersion.current) return;
      throw e;
    }
    if (version !== refreshVersion.current) return;
    setAccounts(nextAccounts);
    setTransactions(transactionPage.data);
    setTxCursor(transactionPage.next_cursor);
    setHolds(holdPage.data);
    setHoldCursor(holdPage.next_cursor);
    setSelectedAccount((old) =>
      nextAccounts.some((account) => account.id === old)
        ? old
        : (nextAccounts.find((account) => account.code === 'DEMO_PRIMARY')?.id ??
          nextAccounts[0]?.id ??
          ''),
    );
    setFrom((old) =>
      nextAccounts.some((account) => account.name === old)
        ? old
        : (nextAccounts.find((account) => account.code === 'DEMO_PRIMARY')?.name ?? ''),
    );
    setTo((old) =>
      nextAccounts.some((account) => account.name === old)
        ? old
        : (nextAccounts.find((account) => account.code === 'DEMO_SECONDARY')?.name ?? ''),
    );
    return nextAccounts;
  }, [ledger, txFilter, holdWhere, mode]);
  refreshRef.current = refresh;
  useEffect(() => {
    inspectionVersion.current++;
    setAccounts([]);
    setTransactions([]);
    setHolds([]);
    setSelectedAccount('');
    setBalance(null);
    setIds(initialIds);
    setExpirationAsOf('');
    setSelectedTx(null);
    setTxEntries([]);
    setBeforeAfter(null);
    setLastSent(null);
    setReference(newReference());
  }, [ledger]);
  useEffect(() => {
    void refresh().catch((e) => setError(errorMessage(e)));
  }, [refresh]);
  useEffect(() => {
    setBalance(null);
    if (
      !accounts.some(
        (account) =>
          account.id === selectedAccount &&
          account.ledger_id === ledger &&
          account.tenant_id === session?.tenant_id,
      )
    )
      return;
    const controller = new AbortController();
    balanceController.current = controller;
    void request<Balance>(
      {
        method: 'GET',
        path: query(`/v1/accounts/${selectedAccount}/balance-as-of`, {
          at: new Date().toISOString(),
        }),
      },
      controller.signal,
    )
      .then((nextBalance) => {
        if (!controller.signal.aborted) setBalance(nextBalance);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      });
    return () => {
      controller.abort();
      if (balanceController.current === controller) balanceController.current = null;
    };
  }, [selectedAccount, accounts, ledger, session?.tenant_id]);
  const execute = async (
    operation: DemoRequest,
    signal?: AbortSignal,
  ): Promise<Json | undefined> => {
    const version = ++executionVersion.current;
    setBusy(true);
    setError(null);
    try {
      // REST requires actor_id in the payload. Library obtains it from the
      // authenticated session, so replaying a Library call through REST restores it.
      if (
        mode === 'rest' &&
        operation.path.startsWith('/v1/adjustments/') &&
        operation.body?.actor_id === undefined
      ) {
        operation = {
          ...operation,
          body: { ...operation.body, actor_id: session?.actor_id ?? '' },
        };
      }
      const result = await request<Json>(operation, signal, true);
      if (signal?.aborted) return undefined;
      // Both executors return the same display shape here. The journal retains
      // the original native Library result inside the transport observer.
      const body = asObject(result);
      if (
        operation.path === '/v1/credit-grants/expiration/preview' &&
        typeof operation.body?.as_of === 'string'
      )
        setExpirationAsOf(operation.body.as_of);
      if (operation.method === 'POST' && operation.path.startsWith('/v1/')) {
        setLastSent(structuredClone(operation));
        if (
          operation.path === '/v1/reconciliation/external-records' ||
          (operation.path === '/v1/reconciliation/runs' && !operation.body?.dry_run)
        ) {
          setReconciliationHistoryRevision((revision) => revision + 1);
        }
        setIds((old) => ({
          ...old,
          ...(typeof body.transaction_id === 'string' ? { tx: body.transaction_id } : {}),
          ...(typeof body.corrected_transaction_id === 'string'
            ? { tx: body.corrected_transaction_id }
            : {}),
          ...(typeof body.hold_id === 'string' ? { hold: body.hold_id } : {}),
          ...(operation.path === '/v1/credit-grants' && typeof body.id === 'string'
            ? { grant: body.id }
            : {}),
          ...(typeof body.upload_id === 'string' ? { upload: body.upload_id } : {}),
          ...(operation.path === '/v1/reconciliation/matching-rules' && typeof body.id === 'string'
            ? { rule: body.id }
            : {}),
          ...(operation.path === '/v1/reconciliation/runs' &&
          typeof body.id === 'string' &&
          !operation.body?.dry_run
            ? { run: body.id }
            : {}),
        }));
        const after = await refreshRef.current();
        if (after) setBeforeAfter({ before: accounts, after });
        if (operation.path === '/v1/ledgers')
          setLedgers(await allPages<Ledger>('/v1/ledgers?limit=200'));
      }
      return result;
    } catch (e) {
      if (!signal?.aborted && version === executionVersion.current) setError(errorMessage(e));
      return undefined;
    } finally {
      if (version === executionVersion.current) setBusy(false);
    }
  };
  const inspectTransaction = async (tx: Transaction) => {
    const version = ++inspectionVersion.current;
    setSelectedTx(tx);
    setIds((old) => ({ ...old, tx: tx.id }));
    setTxEntries([]);
    try {
      const data = await allPages<Entry>(
        query('/v1/entries', { limit: 200, where: formatJson({ transaction_id: { eq: tx.id } }) }),
      );
      if (inspectionVersion.current === version) setTxEntries(data);
    } catch (e) {
      if (inspectionVersion.current === version) setError(errorMessage(e));
    }
  };
  const sendTransfer = async (hold = false) => {
    try {
      const minor = toMinor(amount, scale),
        source = accounts.find((a) => a.name === from),
        target = accounts.find((a) => a.name === to);
      if (!source || !target || source.id === target.id)
        throw new Error('Choose two different accounts');
      const operation: DemoRequest = {
        method: 'POST',
        path: hold ? '/v1/holds' : '/v1/transactions',
        body: {
          ledger_id: ledger,
          reference,
          currency,
          description: `${from} to ${to}`,
          ...(!hold ? { metadata: { order_id: reference, channel: 'web' } } : {}),
          entries: [
            { account_id: source.id, signed_amount_minor: minor, currency },
            { account_id: target.id, signed_amount_minor: `-${minor}`, currency },
          ],
        },
      };
      const result = await execute(operation);
      if (result && !hold) {
        const id = asObject(result).transaction_id;
        if (typeof id === 'string') {
          const t = await request<Transaction>({ method: 'GET', path: `/v1/transactions/${id}` });
          await inspectTransaction(t);
        }
      }
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const moreTransactions = async () => {
    if (!txCursor) return;
    const result = await execute({
      method: 'GET',
      path: query('/v1/transactions', {
        ledger_id: ledger,
        limit: 10,
        cursor: txCursor,
        ...(txFilter ? { where: formatJson({ reference: { eq: txFilter } }) } : {}),
      }),
    });
    if (result) {
      const page = result as unknown as Page<Transaction>;
      setTransactions((old) => [...old, ...page.data]);
      setTxCursor(page.next_cursor);
    }
  };
  const walletAccounts = accounts.filter((a) => a.name.startsWith('wallet:') && !a.grant_enabled);
  const availableAccount = accounts.find((a) => a.id === selectedAccount);
  const baseCreditAccount =
    accounts.find((a) => a.code === 'DEMO_CREDITS' || a.name === 'credits:alice')?.id ??
    selectedAccount;
  const invalidateReads = () => {
    refreshVersion.current++;
    inspectionVersion.current++;
    balanceController.current?.abort();
  };
  return {
    session,
    ledgers,
    ledger,
    setLedger,
    accounts,
    transactions,
    txCursor,
    txFilter,
    setTxFilter,
    holds,
    setHolds,
    holdCursor,
    setHoldCursor,
    holdState,
    setHoldState,
    ids,
    setIds,
    selectedAccount,
    setSelectedAccount,
    balance,
    reconciliationHistoryRevision,
    selectedTx,
    txEntries,
    busy,
    error,
    setError,
    from,
    setFrom,
    to,
    setTo,
    amount,
    setAmount,
    reference,
    setReference,
    expirationAsOf,
    beforeAfter,
    lastSent,
    currency,
    scale,
    holdWhere,
    bootstrap,
    execute,
    inspectTransaction,
    sendTransfer,
    moreTransactions,
    walletAccounts,
    availableAccount,
    baseCreditAccount,
    invalidateReads,
  };
}
export type Sandbox = ReturnType<typeof useSandbox>;

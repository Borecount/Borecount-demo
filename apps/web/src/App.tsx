import { useCallback, useEffect, useRef, useState } from 'react';
import {
  allPages,
  toLibraryCall,
  toRestRequest,
  money,
  observeRequests,
  query,
  request,
  setAccessToken,
  setDemoMode,
  toMinor,
  type DemoMode,
  type Account,
  type Balance,
  type DemoRequest,
  type Entry,
  type Hold,
  type Json,
  type Ledger,
  type Page,
  type RequestRecord,
  type Session,
  type Transaction,
} from './api';
import { operations, scenarios, type Area, type Context, type Operation } from './operations';
import { apiVersion } from './generated-contract';
import { entriesAreBalanced, toEntryDisplay } from './ledger-display';
import { JsonBlock } from './components/DataView';
import { LibraryPreview } from './components/LibraryPreview';
import { ReadPanel } from './components/ReadPanel';
import { ExecutionJournal } from './components/ExecutionJournal';
import { ReconciliationHistory } from './components/ReconciliationHistory';

const areas: Area[] = ['Accounts', 'Transactions', 'Holds', 'Credits', 'Reconciliation', 'Reports'];
const formatJson = (v: unknown) => JSON.stringify(v, null, 2);
const newReference = () => `demo-${crypto.randomUUID().slice(0, 8)}`;
const initialIds = { tx: '', hold: '', grant: '', upload: '', rule: '', run: '' };
const asObject = (value: Json): Record<string, Json> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function App() {
  // Integration mode and sandbox identity are shared by every workspace section.
  const [mode, setMode] = useState<DemoMode>('rest');
  const [libraryDraft, setLibraryDraft] = useState('{}');
  const [session, setSession] = useState<Session | null>(null);
  const [area, setArea] = useState<Area>('Accounts');

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
  const [records, setRecords] = useState<RequestRecord[]>([]);
  const [recordId, setRecordId] = useState<number | null>(null);

  // The operation draft has two editable representations of the same action.
  const [preset, setPreset] = useState<Operation | null>(null);
  const [draftPath, setDraftPath] = useState('/v1/transactions');
  const [draftMethod, setDraftMethod] = useState<'GET' | 'POST'>('POST');
  const [draftBody, setDraftBody] = useState('{}');
  const [lastSent, setLastSent] = useState<DemoRequest | null>(null);
  const [scenario, setScenario] = useState<number | null>(null);
  const [step, setStep] = useState(0);
  const [from, setFrom] = useState('wallet:alice');
  const [to, setTo] = useState('wallet:bob');
  const [amount, setAmount] = useState('25.00');
  const [reference, setReference] = useState(newReference);
  const [reportFrom, setReportFrom] = useState(new Date(Date.now() - 7 * 86400000).toISOString());
  const [reportAsOf, setReportAsOf] = useState(new Date().toISOString());
  const [expirationAsOf, setExpirationAsOf] = useState('');
  const [beforeAfter, setBeforeAfter] = useState<{ before: Account[]; after: Account[] } | null>(
    null,
  );

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
  const context: Context = {
    actor: session?.actor_id ?? '',
    ledger,
    currency,
    accounts,
    ...ids,
    expirationAsOf,
  };
  const holdWhere = JSON.stringify({
    ledger_id: { eq: ledger },
    ...(holdState ? { state: { eq: holdState } } : {}),
  });
  const journal = records.find((r) => r.id === recordId) ?? records[0];

  useEffect(
    () =>
      observeRequests((record) => {
        setRecords((old) => [record, ...old].slice(0, 150));
        if (record.foreground) setRecordId(record.id);
      }),
    [],
  );

  const bootstrap = useCallback(async (fresh: boolean) => {
    setBusy(true);
    setError(null);
    if (fresh) {
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
      setPreset(null);
      setScenario(null);
      setRecordId(null);
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
    setAccounts([]);
    setTransactions([]);
    setHolds([]);
    setSelectedAccount('');
    setBalance(null);
    setIds(initialIds);
    setExpirationAsOf('');
    setSelectedTx(null);
    setTxEntries([]);
    setPreset(null);
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
      .then(setBalance)
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
  const selectReconciliationId = (key: 'upload' | 'rule' | 'run', id: string) => {
    setIds((old) => ({ ...old, [key]: id }));
    setPreset(null);
  };
  const choose = (operation: Operation) => {
    const draft = operation.build(context, newReference());
    setPreset(operation);
    setDraftPath(draft.path);
    setDraftMethod(draft.method);
    setDraftBody(formatJson(draft.body ?? {}));
    setLibraryDraft(formatJson(toLibraryCall(draft).input));
  };
  // Both modes use the same sandbox. Invalidate in-flight reads before changing
  // the executor so a late response cannot replace data from the new mode.
  // Writes keep the switch disabled until their post-write refresh completes.
  const switchMode = (next: DemoMode) => {
    if (next === mode || busy) return;
    refreshVersion.current++;
    inspectionVersion.current++;
    balanceController.current?.abort();
    setDemoMode(next);
    setMode(next);
    setError(null);
    // Translate the existing draft to preserve edited amounts and references.
    // Invalid drafts can be reopened from the current scenario after the switch.
    if (preset) {
      try {
        if (next === 'library') {
          const currentRequest: DemoRequest = { method: draftMethod, path: draftPath };
          if (draftMethod === 'POST') {
            currentRequest.body = JSON.parse(draftBody);
          }
          const libraryCall = toLibraryCall(currentRequest);
          setLibraryDraft(formatJson(libraryCall.input));
        } else {
          const libraryMethod = toLibraryCall({ method: draftMethod, path: draftPath }).operation;
          const operation = toRestRequest({
            operation: libraryMethod,
            input: JSON.parse(libraryDraft),
          });
          if (operation.path.startsWith('/v1/adjustments/')) {
            operation.body = { ...operation.body, actor_id: session?.actor_id ?? '' };
          }
          setDraftMethod(operation.method);
          setDraftPath(operation.path);
          setDraftBody(formatJson(operation.body ?? {}));
        }
      } catch {
        setPreset(null);
      }
    }
  };
  const switchArea = (next: Area) => {
    setArea(next);
    setPreset(null);
  };
  const openOperation = (id: string) => {
    const operation = operations.find((candidate) => candidate.id === id)!;
    setArea(operation.area);
    choose(operation);
  };
  const submitDraft = async () => {
    try {
      if (mode === 'library') {
        const call = toLibraryCall({ method: draftMethod, path: draftPath });
        call.input = JSON.parse(libraryDraft);
        await execute({ ...toRestRequest(call), libraryCall: call });
        return;
      }
      const body = draftMethod === 'POST' && draftBody.trim() ? JSON.parse(draftBody) : undefined;
      if (body !== undefined && (body === null || Array.isArray(body) || typeof body !== 'object'))
        throw new Error('Request body must be a JSON object');
      await execute({ method: draftMethod, path: draftPath, ...(body ? { body } : {}) });
    } catch (e) {
      setError(errorMessage(e));
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
  const reportQuery = { from: reportFrom, as_of: reportAsOf, limit: 25 };

  return (
    <main>
      <header>
        <a className="brand" href="/">
          <span className="mark">B</span>Borecount
        </a>
        <nav>
          <a href="https://github.com/Borecount/Borecount" target="_blank" rel="noreferrer">
            GitHub ↗
          </a>
          <a href="/docs?demo=1" target="_blank" rel="noreferrer">
            API docs ↗
          </a>
        </nav>
      </header>
      <section className="hero">
        <p className="eyebrow">OPEN-SOURCE FINANCIAL INFRASTRUCTURE</p>
        <h1>The ledger layer for products that move money.</h1>
        <p className="hero-copy">
          Build wallets, marketplaces, payouts, and stored-value products without maintaining
          double-entry invariants in application code.
        </p>
        <div className="hero-actions">
          <a className="button-link primary" href="#flows">
            Try the live demo
          </a>
          <a
            className="button-link secondary"
            href="mailto:herman.klushin@gmail.com?subject=Borecount%20design%20partnership"
          >
            Become a design partner
          </a>
        </div>
        <p className="hero-note">
          Built for Node.js teams · PostgreSQL-backed · Framework-agnostic core
        </p>
      </section>
      <div className="proof-strip hero-proof">
        <div>
          <strong>Atomic</strong>
          <span>postings, holds and bulk rollback</span>
        </div>
        <div>
          <strong>Idempotent</strong>
          <span>safe retries by reference</span>
        </div>
        <div>
          <strong>Auditable</strong>
          <span>reversals, history and statements</span>
        </div>
        <div>
          <strong>Reconciled</strong>
          <span>provider matching and reports</span>
        </div>
      </div>
      <section className="integration-mode" aria-label="Integration mode">
        <div>
          <strong>Integration mode</strong>
          <p>
            {mode === 'rest'
              ? 'Explore every workflow through the REST API.'
              : 'Calls the library directly on the demo server. Shares your current sandbox.'}
          </p>
        </div>
        <div className="mode-switch" role="group" aria-label="Integration mode">
          <button aria-pressed={mode === 'rest'} disabled={busy} onClick={() => switchMode('rest')}>
            REST API
          </button>
          <button
            aria-pressed={mode === 'library'}
            disabled={busy}
            onClick={() => switchMode('library')}
          >
            Library
          </button>
        </div>
      </section>
      <section className="flow-guide" id="flows" aria-label="Guided demo flows">
        <div className="flow-guide-heading">
          <div className="section-intro compact">
            <p className="eyebrow">GUIDED DEMO</p>
            <h2>Explore real ledger flows.</h2>
            <p>
              Choose a workflow, edit its inputs and inspect each result in your selected
              integration mode.
            </p>
          </div>
          <a href="#workspace">
            Open workspace <span aria-hidden="true">↗</span>
          </a>
        </div>
        <div className="scenario-grid">
          {scenarios.map((s, i) => (
            <button
              className="scenario-card"
              disabled={!session || busy}
              key={s.name}
              onClick={() => {
                setScenario(i);
                setStep(0);
                openOperation(s.steps[0]);
                document.getElementById('workspace')?.scrollIntoView({ behavior: 'smooth' });
              }}
            >
              <span className="scenario-number">
                0{i + 1} <span>↗</span>
              </span>
              <h3>{s.name}</h3>
              <p>{s.summary}</p>
              <small>{s.steps.length} steps · editable inputs</small>
            </button>
          ))}
        </div>
        <p className="flow-primer">
          <strong>Reading the ledger</strong>
          <span>
            From the platform's perspective, customer wallets are CREDIT-normal liabilities.
            Positive entries are debits; negative entries are credits. Debiting a wallet lowers its
            displayed balance.{' '}
            {mode === 'rest'
              ? 'Amounts use integer strings in minor units.'
              : 'Library amounts use bigint minor units.'}
          </span>
        </p>
      </section>
      <section className="workspace-shell" id="workspace" aria-label="Live demo workspace">
        {error && (
          <div className="error" role="alert">
            {error}
            <button aria-label="Dismiss error" onClick={() => setError(null)}>
              ×
            </button>
          </div>
        )}
        <div className="workspace-top">
          <div className="workspace-heading">
            <p className="eyebrow">LIVE DEMO · v{apiVersion}</p>
            <h2>Ledger workspace</h2>
            <div className="sandbox-line">
              <p className="workspace-session">
                <span className={`status-dot ${session ? 'online' : ''}`} />
                {session
                  ? 'Sandbox ready · private tenant'
                  : error
                    ? 'Sandbox unavailable'
                    : 'Connecting to sandbox…'}
              </p>
              <button
                className="secondary"
                disabled={busy}
                title={
                  session
                    ? 'Create a fresh private demo with new accounts and balances. You will lose access to this sandbox; its history is retained.'
                    : 'Create a private demo tenant with sample accounts and balances.'
                }
                onClick={() => void bootstrap(true)}
              >
                {session ? 'New sandbox' : 'Start sandbox'}
              </button>
            </div>
          </div>
        </div>
        <div className="workspace-controls">
          <div className="workspace-ledger">
            <label htmlFor="workspace-ledger">Active ledger</label>
            <select
              id="workspace-ledger"
              aria-label="Ledger"
              aria-describedby="ledger-currency-note"
              value={ledger}
              disabled={busy}
              onChange={(e) => {
                setLedger(e.target.value);
                setTxFilter('');
              }}
            >
              {ledgers.map((l) => (
                <option value={l.id} key={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="ledger-currency-note" id="ledger-currency-note">
          <strong>Demo limitation:</strong> one currency per ledger (USD or EUR). The library
          supports mixed-currency accounts in one ledger, but each transaction or hold uses one
          currency. Cross-currency transfers and FX conversion are not available.
        </p>
        <nav className="tabs" aria-label="Workspace sections">
          {areas.map((name) => (
            <button
              key={name}
              aria-current={area === name ? 'page' : undefined}
              onClick={() => switchArea(name)}
            >
              {name}
            </button>
          ))}
        </nav>

        {scenario !== null && (
          <section className="scenario-banner">
            <div>
              <span className="eyebrow">
                GUIDED SCENARIO · {step + 1}/{scenarios[scenario].steps.length}
              </span>
              <h2>{scenarios[scenario].name}</h2>
              <p>{operations.find((o) => o.id === scenarios[scenario].steps[step])?.help}</p>
            </div>
            <div className="actions">
              <button
                className="secondary"
                disabled={busy}
                onClick={() => openOperation(scenarios[scenario].steps[step])}
              >
                Open current step
              </button>
              <button
                className="primary"
                disabled={busy || step >= scenarios[scenario].steps.length - 1}
                onClick={() => {
                  const next = step + 1;
                  setStep(next);
                  openOperation(scenarios[scenario].steps[next]);
                }}
              >
                Next step →
              </button>
              <button className="text-button" onClick={() => setScenario(null)}>
                Exit guide
              </button>
            </div>
          </section>
        )}

        {area === 'Accounts' && (
          <>
            <section className="panel">
              <div className="panel-title">
                <h2>Chart of accounts</h2>
                <span>{accounts.length} accounts · all cursor pages loaded</span>
              </div>
              <div className="account-grid">
                {accounts.map((a) => (
                  <button
                    className={`account-card ${selectedAccount === a.id ? 'selected' : ''}`}
                    key={a.id}
                    data-testid={`account-${a.name}`}
                    onClick={() => setSelectedAccount(a.id)}
                  >
                    <div>
                      <span className="badge">{a.side}</span>
                      {a.grant_enabled && <span className="badge credit">GRANT</span>}
                    </div>
                    <h3>{a.name}</h3>
                    <b>
                      {money(
                        (a.side === 'CREDIT'
                          ? -BigInt(a.balance_minor)
                          : BigInt(a.balance_minor)
                        ).toString(),
                        a.currency,
                        scale,
                      )}
                    </b>
                    <small>{a.overdraft_policy} overdraft</small>
                    <code>{a.id}</code>
                  </button>
                ))}
              </div>
            </section>
            {balance && (
              <section className="balance-strip">
                <div>
                  <span>Selected</span>
                  <strong>{availableAccount?.name}</strong>
                </div>
                <div>
                  <span>Posted · canonical sign</span>
                  <strong>{money(balance.posted_minor, currency, scale)}</strong>
                </div>
                <div>
                  <span>Reserved delta</span>
                  <strong>{money(balance.reserved_delta_minor, currency, scale)}</strong>
                </div>
                <div>
                  <span>Available</span>
                  <strong data-testid="available-balance">
                    {money(balance.available_minor, currency, scale)}
                  </strong>
                </div>
              </section>
            )}
            <ReadPanel
              mode={mode}
              key={`${mode}:Account directory`}
              title="Account directory"
              path={query('/v1/accounts', { ledger_id: ledger, limit: 25 })}
              execute={execute}
              busy={busy}
            />
          </>
        )}

        {area === 'Transactions' && (
          <>
            <section className="grid">
              <form
                className="panel transfer"
                onSubmit={(e) => {
                  e.preventDefault();
                  void sendTransfer();
                }}
              >
                <div className="panel-title">
                  <h2>New transfer</h2>
                  <span>{currency} · double-entry</span>
                </div>
                <label>
                  From
                  <select value={from} onChange={(e) => setFrom(e.target.value)}>
                    {walletAccounts.map((a) => (
                      <option key={a.id}>{a.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  To
                  <select value={to} onChange={(e) => setTo(e.target.value)}>
                    {walletAccounts.map((a) => (
                      <option key={a.id}>{a.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Amount
                  <input
                    aria-label="Transfer amount"
                    value={amount}
                    inputMode="decimal"
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </label>
                <label>
                  Reference
                  <input
                    aria-label="Transfer reference"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                  />
                </label>
                <div className="actions">
                  <button className="primary" disabled={busy || !session}>
                    Send transfer
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy || !session}
                    onClick={() => void sendTransfer(true)}
                  >
                    Reserve transfer
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setReference(newReference())}
                  >
                    New reference
                  </button>
                </div>
              </form>
              <div className="panel">
                <p className="eyebrow">RETRIES YOU CAN SEE</p>
                <h2>One reference. One posting.</h2>
                <p>
                  Send a transfer twice with the same reference and payload.{' '}
                  {mode === 'rest'
                    ? 'The first returns 201; the repeat returns 200 and created: false.'
                    : 'The first returns created: true; the repeat returns the same transactionId and created: false.'}
                </p>
                <p>
                  Change the amount while keeping the reference to inspect a payload mismatch. The
                  original posting remains unchanged.
                </p>
                <p className="muted">
                  Reversal and correction work on the transaction selected below.
                </p>
              </div>
            </section>
            <section className="panel ledger">
              <div className="panel-title">
                <h2>Transactions</h2>
                <span>10 per page · select to inspect</span>
              </div>
              <label>
                Exact reference filter
                <input
                  placeholder="All references"
                  value={txFilter}
                  onChange={(e) => setTxFilter(e.target.value)}
                />
              </label>
              {transactions.map((t) => (
                <button
                  className={`transaction-row ${ids.tx === t.id ? 'selected' : ''}`}
                  key={t.id}
                  onClick={() => void inspectTransaction(t)}
                >
                  <div>
                    <strong>{t.description ?? t.reference}</strong>
                    <code>{t.reference}</code>
                  </div>
                  <span>{t.relation_type ?? 'POSTING'}</span>
                  <time>{new Date(t.effective_at).toLocaleString()}</time>
                  <span>↗</span>
                </button>
              ))}
              {!transactions.length && <p className="muted">No matching transactions.</p>}
              {txCursor && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void moreTransactions()}
                >
                  Load more transactions
                </button>
              )}
            </section>
            {selectedTx && (
              <section className="panel ledger">
                <div className="panel-title">
                  <h2>How Borecount recorded it</h2>
                  <span>{selectedTx.reference}</span>
                </div>
                <p>
                  <code>{selectedTx.id}</code>
                </p>
                <p>
                  Effective: {selectedTx.effective_at} · Created: {selectedTx.created_at}
                </p>
                {selectedTx.related_transaction_id && (
                  <p>
                    {selectedTx.relation_type} → <code>{selectedTx.related_transaction_id}</code>
                  </p>
                )}
                {txEntries.map((e) => {
                  const d = toEntryDisplay(e.signed_amount_minor);
                  return (
                    <div className="entry" key={e.id}>
                      <span className={`badge ${d?.direction.toLowerCase()}`}>{d?.direction}</span>
                      <strong>
                        {accounts.find((a) => a.id === e.account_id)?.name ?? e.account_id}
                      </strong>
                      <span>{money(d?.magnitudeMinor ?? '0', e.currency, scale)}</span>
                    </div>
                  );
                })}
                <p className="balanced">
                  {entriesAreBalanced(txEntries)
                    ? '✓ Debits and credits balance'
                    : 'Loading entries…'}
                </p>
                <details>
                  <summary>Metadata</summary>
                  <JsonBlock value={selectedTx.metadata} />
                </details>
              </section>
            )}
          </>
        )}

        {area === 'Holds' && (
          <section className="panel" aria-label="Transfer holds">
            <div className="panel-title">
              <h2>Payment authorizations</h2>
              <span>50 per page</span>
            </div>
            <label>
              Hold state
              <select
                disabled={busy}
                value={holdState}
                onChange={(e) => {
                  setHoldState(e.target.value as Hold['state'] | '');
                  setHolds([]);
                  setHoldCursor(null);
                  setIds((old) => ({ ...old, hold: '' }));
                }}
              >
                <option value="">All states</option>
                <option value="HELD">Active (HELD)</option>
                <option value="APPLIED">Applied (APPLIED)</option>
                <option value="VOIDED">Voided (VOIDED)</option>
              </select>
            </label>
            {!holds.length && (
              <p>
                {holdState
                  ? 'No holds match this state.'
                  : 'No holds yet. Reserve a payment to begin.'}
              </p>
            )}
            {holds.map((h) => (
              <article className={`hold-row ${ids.hold === h.id ? 'selected' : ''}`} key={h.id}>
                <div>
                  <strong>{h.description ?? h.reference}</strong>
                  <code>{h.reference}</code>
                </div>
                <span className="badge">{h.state}</span>
                <span>
                  {money(h.original_amount_minor, currency, scale)} / remaining{' '}
                  {money(h.remaining_amount_minor, currency, scale)}
                </span>
                <button
                  className="secondary"
                  onClick={() => setIds((old) => ({ ...old, hold: h.id }))}
                >
                  Select hold
                </button>
              </article>
            ))}
            {holdCursor && (
              <button
                className="secondary"
                disabled={busy}
                onClick={async () => {
                  const result = await execute({
                    method: 'GET',
                    path: query('/v1/holds', { where: holdWhere, cursor: holdCursor }),
                  });
                  if (result) {
                    const p = result as unknown as Page<Hold>;
                    setHolds((old) => [...old, ...p.data]);
                    setHoldCursor(p.next_cursor);
                  }
                }}
              >
                Load more holds
              </button>
            )}
            <p>
              Selected hold: <code>{ids.hold || 'Create or select one'}</code>
            </p>
          </section>
        )}

        {area === 'Credits' && (
          <>
            <section className="panel">
              <p className="eyebrow">PREPAID CAPACITY</p>
              <h2>From issuance to consumption.</h2>
              <p>
                Issue multiple grants, spend from the promotional account, then inspect which lots
                funded each entry. Holds reserve capacity; refunds and expiration operate on the
                remaining eligible capacity.
              </p>
              <label>
                Selected grant ID
                <input
                  aria-label="Selected grant ID"
                  value={ids.grant}
                  placeholder="Issue a grant or paste an ID from the directory"
                  onChange={(e) => setIds((old) => ({ ...old, grant: e.target.value }))}
                />
              </label>
              <p className="muted">
                A full reversal requires an untouched grant. Refunds cannot return consumed, expired
                or actively reserved capacity.
              </p>
            </section>
            <div className="read-grid">
              <ReadPanel
                mode={mode}
                key={`${mode}:Credit balance`}
                title="Credit balance"
                path={`/v1/accounts/${baseCreditAccount}/credit-balance`}
                execute={execute}
                busy={busy}
              />
              <ReadPanel
                mode={mode}
                key={`${mode}:Credit lots`}
                title="Credit lots"
                path={`/v1/accounts/${baseCreditAccount}/credit-lots?limit=25`}
                execute={execute}
                busy={busy}
              />
            </div>
            <ReadPanel
              mode={mode}
              key={`${mode}:Grant directory`}
              title="Grant directory"
              path={query('/v1/credit-grants', { account_id: baseCreditAccount, limit: 25 })}
              execute={execute}
              busy={busy}
            />
          </>
        )}

        {area === 'Reconciliation' && session && ledger && (
          <>
            <section className="panel">
              <p className="eyebrow">PROVIDER STATEMENT ↔ LEDGER</p>
              <h2>Make differences explainable.</h2>
              <p>
                Create rules, upload normalized records, preview matching and persist a report.
                Review matched, mismatched, unmatched external/internal and conflict results.
              </p>
              <div className="field-grid">
                {(['upload', 'rule', 'run'] as const).map((key) => (
                  <label key={key}>
                    {key} ID
                    <input
                      aria-label={`${key} ID`}
                      value={ids[key]}
                      placeholder="Filled by the corresponding result"
                      onChange={(e) => selectReconciliationId(key, e.target.value)}
                    />
                  </label>
                ))}
              </div>
              <p className="muted">
                Selecting an ID closes the current request draft. Choose an operation to use the
                selected IDs. Matching strategy: one_to_one. Use amount_tolerance_minor and
                date_tolerance_seconds inside rule criteria.{' '}
                {mode === 'rest'
                  ? 'CSV import is converted locally to the documented JSON request.'
                  : 'CSV import becomes arguments for services.reconciliation.ingest.'}
              </p>
            </section>
            <ReadPanel
              mode={mode}
              key={`${mode}:Matching rules`}
              title="Matching rules"
              path="/v1/reconciliation/matching-rules?limit=25"
              execute={execute}
              busy={busy}
            />
            <ReconciliationHistory
              key={`${mode}:uploads:${session?.tenant_id ?? ''}:${reconciliationHistoryRevision}`}
              title="Saved uploads"
              path="/v1/reconciliation/uploads?limit=25"
              idField="upload_id"
              selectedId={ids.upload}
              onSelect={(upload) => selectReconciliationId('upload', upload)}
              busy={busy}
            />
            <ReconciliationHistory
              key={`${mode}:runs:${session?.tenant_id ?? ''}:${ledger}:${reconciliationHistoryRevision}`}
              title="Saved runs"
              path={query('/v1/reconciliation/runs', {
                where: JSON.stringify({ ledger_id: { eq: ledger } }),
                limit: 25,
              })}
              idField="id"
              selectedId={ids.run}
              onSelect={(run) => selectReconciliationId('run', run)}
              busy={busy}
            />
            {ids.run && (
              <>
                <ReadPanel
                  mode={mode}
                  key={`${mode}:report:${session.tenant_id}:${ids.run}`}
                  title="Run report"
                  path={`/v1/reconciliation/runs/${ids.run}`}
                  execute={execute}
                  busy={busy}
                />
                <ReadPanel
                  mode={mode}
                  key={`${mode}:results:${session.tenant_id}:${ids.run}`}
                  title="Reconciliation results"
                  path={`/v1/reconciliation/runs/${ids.run}/results?limit=25`}
                  execute={execute}
                  busy={busy}
                />
              </>
            )}
          </>
        )}

        {area === 'Reports' && (
          <>
            <section className="panel">
              <div className="panel-title">
                <h2>Reporting boundaries</h2>
                <span>Explicit, stable time windows</span>
              </div>
              <div className="field-grid">
                <label>
                  Account
                  <select
                    aria-label="Report account"
                    value={selectedAccount}
                    onChange={(e) => setSelectedAccount(e.target.value)}
                  >
                    {accounts.map((a) => (
                      <option value={a.id} key={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  From · ISO timestamp
                  <input value={reportFrom} onChange={(e) => setReportFrom(e.target.value)} />
                </label>
                <label>
                  As of · ISO timestamp
                  <input value={reportAsOf} onChange={(e) => setReportAsOf(e.target.value)} />
                </label>
              </div>
              <button
                className="text-button"
                onClick={() => setReportAsOf(new Date().toISOString())}
              >
                Set as of to now
              </button>
              <p className="muted">
                Opening includes events at from; movements cover (from, as_of]. Reconcile opening +
                deltas = closing across all pages. Credit capacity uses creation time; account
                history uses effective time.
              </p>
            </section>
            <ReadPanel
              mode={mode}
              key={`${mode}:Historical balance`}
              title="Historical balance"
              path={query(`/v1/accounts/${selectedAccount}/balance-as-of`, { at: reportAsOf })}
              execute={execute}
              busy={busy}
            />
            <ReadPanel
              mode={mode}
              key={`${mode}:Balance history`}
              title="Balance history"
              path={query(`/v1/accounts/${selectedAccount}/balance-history`, {
                from: reportFrom,
                to: reportAsOf,
                limit: 25,
              })}
              execute={execute}
              busy={busy}
            />
            <ReadPanel
              mode={mode}
              key={`${mode}:Account statement`}
              title="Account statement"
              path={query(`/v1/accounts/${selectedAccount}/statement`, reportQuery)}
              execute={execute}
              busy={busy}
            />
            <ReadPanel
              mode={mode}
              key={`${mode}:Credit statement`}
              title="Credit statement"
              path={query(`/v1/accounts/${baseCreditAccount}/credit-statement`, {
                ...reportQuery,
                ...(ids.grant ? { grant_id: ids.grant } : {}),
              })}
              execute={execute}
              busy={busy}
            />
            <ReadPanel
              mode={mode}
              key={`${mode}:Trial balance`}
              title="Trial balance"
              path={`/v1/ledgers/${ledger}/trial-balance`}
              execute={execute}
              busy={busy}
            />
          </>
        )}

        {area !== 'Reports' && (
          <section className="panel workbench">
            <div className="panel-title">
              <h2>Operation workbench</h2>
              <span>
                {mode === 'rest'
                  ? 'Real payloads · editable JSON'
                  : 'Direct service calls · editable arguments'}
              </span>
            </div>
            <div className="operation-grid">
              {operations
                .filter((o) => o.area === area)
                .map((o) => (
                  <button
                    key={o.id}
                    className={`operation-chip ${preset?.id === o.id ? 'selected' : ''}`}
                    disabled={!session || busy}
                    onClick={() => choose(o)}
                  >
                    {o.title}
                  </button>
                ))}
            </div>
            {preset && (
              <>
                <div className="workbench-intro">
                  <h3>{preset.title}</h3>
                  <p>{preset.help}</p>
                </div>
                {mode === 'rest' ? (
                  <>
                    <div className="request-editor-line">
                      <select
                        aria-label="Request method"
                        value={draftMethod}
                        onChange={(e) => setDraftMethod(e.target.value as 'GET' | 'POST')}
                      >
                        <option>POST</option>
                        <option>GET</option>
                      </select>
                      <input
                        aria-label="Request path"
                        value={draftPath}
                        onChange={(e) => setDraftPath(e.target.value)}
                      />
                    </div>
                    {draftMethod === 'POST' && (
                      <label>
                        Request JSON
                        <textarea
                          aria-label="Request JSON"
                          value={draftBody}
                          onChange={(e) => setDraftBody(e.target.value)}
                          rows={17}
                          spellCheck={false}
                        />
                      </label>
                    )}
                  </>
                ) : (
                  <>
                    <p className="library-method">
                      <code>
                        services.{toLibraryCall({ method: draftMethod, path: draftPath }).operation}
                      </code>
                    </p>
                    <label>
                      Library arguments
                      <textarea
                        aria-label="Library arguments"
                        value={libraryDraft}
                        onChange={(e) => setLibraryDraft(e.target.value)}
                        rows={17}
                        spellCheck={false}
                      />
                    </label>
                    <p className="muted">
                      Edit structured arguments. Amounts become bigint and timestamps become Date
                      values. The server supplies your sandbox tenant and actor.
                    </p>
                    <LibraryPreview
                      call={() => ({
                        operation: toLibraryCall({ method: draftMethod, path: draftPath })
                          .operation,
                        input: JSON.parse(libraryDraft),
                      })}
                      tenantId={session?.tenant_id}
                      actorId={session?.actor_id}
                    />
                  </>
                )}
                {preset.id === 'upload' && (
                  <label>
                    Import statement CSV
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        try {
                          const { parseStatementCsv } = await import('./csv');
                          const body = {
                            source: file.name,
                            records: parseStatementCsv(await file.text()),
                          };
                          if (mode === 'rest') setDraftBody(formatJson(body));
                          else
                            setLibraryDraft(
                              formatJson(
                                toLibraryCall({
                                  method: 'POST',
                                  path: '/v1/reconciliation/external-records',
                                  body,
                                }).input,
                              ),
                            );
                        } catch (cause) {
                          setError(errorMessage(cause));
                        }
                        e.target.value = '';
                      }}
                    />
                    <small>
                      Headers: id, amount_minor, currency, reference, date, description (optional).
                      Quoted CSV fields are supported.
                    </small>
                  </label>
                )}
                <div className="actions">
                  <button
                    className="primary"
                    disabled={busy || !session}
                    onClick={() => void submitDraft()}
                  >
                    {busy ? 'Running…' : mode === 'rest' ? 'Send request' : 'Run library call'}
                  </button>
                  <button className="secondary" disabled={busy} onClick={() => choose(preset)}>
                    {preset.id === 'expiration-preview'
                      ? 'Refresh preview timestamp'
                      : preset.id === 'expiration-run'
                        ? 'Use latest preview timestamp'
                        : 'Regenerate with new reference'}
                  </button>
                  {mode === 'rest' && (
                    <a
                      className="text-button"
                      href={`/docs?demo=1&filter=${encodeURIComponent(draftPath.split('?')[0].split('/').slice(0, 3).join('/'))}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View API docs ↗
                    </a>
                  )}
                </div>
              </>
            )}
          </section>
        )}

        {beforeAfter && (
          <details className="panel ledger">
            <summary>Balance changes from the last successful write</summary>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Before</th>
                    <th>After</th>
                    <th>Delta · canonical sign</th>
                  </tr>
                </thead>
                <tbody>
                  {beforeAfter.after.map((a) => {
                    const before =
                      beforeAfter.before.find((b) => b.id === a.id)?.balance_minor ?? '0';
                    return (
                      <tr key={a.id}>
                        <td>{a.name}</td>
                        <td>{money(before, currency, scale)}</td>
                        <td>{money(a.balance_minor, currency, scale)}</td>
                        <td>
                          {money(
                            (BigInt(a.balance_minor) - BigInt(before)).toString(),
                            currency,
                            scale,
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>
        )}

        <ExecutionJournal
          records={records}
          selectedRecord={journal}
          onSelect={setRecordId}
          onExecute={execute}
          lastWrite={lastSent}
          mode={mode}
          session={session}
          busy={busy}
          onError={setError}
        />
      </section>
      <footer>
        <div className="brand">
          <span className="mark">B</span>Borecount
        </div>
        <p>Open-source double-entry ledger infrastructure.</p>
        <div>
          <a href="/docs?demo=1" target="_blank" rel="noreferrer">
            API docs
          </a>
          <a href="/openapi.yaml" target="_blank" rel="noreferrer">
            OpenAPI
          </a>
        </div>
      </footer>
    </main>
  );
}

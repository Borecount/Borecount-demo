import { useCallback, useEffect, useRef, useState } from 'react';
import { allPages, money, observeRequests, query, request, requestToCurl, setAccessToken, toMinor,
  type Account, type Balance, type DemoRequest, type Entry, type Hold, type Json, type Ledger, type Page, type RequestRecord, type Session, type Transaction } from './api';
import { operations, scenarios, type Area, type Context, type Operation } from './operations';
import { entriesAreBalanced, toEntryDisplay } from './ledger-display';

const areas: Area[] = ['Accounts', 'Transactions', 'Holds', 'Credits', 'Reconciliation', 'Reports'];
const pretty = (v: unknown) => JSON.stringify(v, null, 2);
const ref = () => `demo-${crypto.randomUUID().slice(0, 8)}`;
const initialIds = { tx: '', hold: '', grant: '', upload: '', rule: '', run: '' };
const asObject = (value: Json): Record<string, Json> => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const describe = (e: unknown) => e instanceof Error ? e.message : String(e);
async function copyText(value: string) {
  try { await navigator.clipboard.writeText(value); return; } catch { /* Fall back for denied clipboard permissions. */ }
  const input = document.createElement('textarea'); input.value = value; input.style.position = 'fixed'; input.style.opacity = '0';
  document.body.append(input); input.select();
  const copied = document.execCommand('copy'); input.remove();
  if (!copied) throw new Error('Clipboard unavailable. Select and copy the cURL text.');
}
function JsonBlock({ value }: { value: unknown }) { return <pre>{pretty(value)}</pre>; }
function DataTable({ rows }: { rows: Record<string, Json>[] }) {
  if (!rows.length) return <p className="muted">No records in this page.</p>;
  const columns = Object.keys(rows[0]);
  return <div className="table-scroll"><table><thead><tr>{columns.map(k => <th key={k}>{k}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={String(row.id ?? i)}>{columns.map(k => <td key={k}>{typeof row[k] === 'object' ? pretty(row[k]) : String(row[k] ?? '—')}</td>)}</tr>)}</tbody></table></div>;
}

function ReadPanel({ title, path, busy, execute }: { title: string; path: string; busy: boolean; execute: (op: DemoRequest) => Promise<Json | undefined> }) {
  const [url, setUrl] = useState(path), [result, setResult] = useState<Json>(null), [where, setWhere] = useState('{}');
  const [continuation, setContinuation] = useState<string | null>(null);
  useEffect(() => { setUrl(path); setResult(null); setContinuation(null); setWhere('{}'); }, [path]);
  const load = async (next = false) => {
    try {
      const target = new URL(next && continuation ? continuation : url, window.location.origin);
      if (!next) {
        const filter = JSON.parse(where);
        if (Object.keys(filter).length) target.searchParams.set('where', JSON.stringify(filter));
        else target.searchParams.delete('where');
        target.searchParams.delete('cursor');
      }
      const value = await execute({ method: 'GET', path: target.pathname + target.search });
      if (value === undefined) return;
      setResult(value);
      const body = asObject(value);
      if (typeof body.next_cursor === 'string') { target.searchParams.set('cursor', body.next_cursor); setContinuation(target.pathname + target.search); }
      else setContinuation(null);
    } catch (e) { setResult({ error: describe(e) }); }
  };
  const object = asObject(result);
  return <section className="panel read-panel"><div className="panel-title"><h2>{title}</h2><span>Canonical API</span></div>
    <label>Request URL<input value={url} onChange={e => { setUrl(e.target.value); setContinuation(null); }} /></label>
    <details className="filter-details"><summary>Server filters · where JSON</summary><p className="muted">Use only fields allowed by this endpoint. Filters are ANDed. Metadata paths are excluded. See API docs for field schemas.</p>
      <textarea aria-label={`${title} filters`} value={where} onChange={e => { setWhere(e.target.value); setContinuation(null); }} rows={4} spellCheck={false} />
    </details>
    <div className="actions"><button className="primary" disabled={busy} onClick={() => void load()}>Load {title.toLowerCase()}</button>
      {continuation && <button className="secondary" disabled={busy} onClick={() => void load(true)}>Next page</button>}</div>
    {result !== null && <><div className="result-summary">{Array.isArray(object.data) ? `${object.data.length} records · ${continuation ? 'more pages available' : 'last page'}` : 'Response'}</div>
      {Array.isArray(object.data) ? <><DataTable rows={object.data as Record<string, Json>[]} />{Object.keys(object).some(k => !['data', 'next_cursor'].includes(k)) && <details><summary>Opening / closing totals and scope</summary><JsonBlock value={{ ...object, data: undefined }} /></details>}</> : <JsonBlock value={result} />}</>}
  </section>;
}

export function App() {
  const [session, setSession] = useState<Session | null>(null), [area, setArea] = useState<Area>('Accounts');
  const [ledgers, setLedgers] = useState<Ledger[]>([]), [ledger, setLedger] = useState(''), [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]), [txCursor, setTxCursor] = useState<string | null>(null), [txFilter, setTxFilter] = useState('');
  const [holds, setHolds] = useState<Hold[]>([]), [holdCursor, setHoldCursor] = useState<string | null>(null);
  const [ids, setIds] = useState(initialIds), [selectedAccount, setSelectedAccount] = useState(''), [balance, setBalance] = useState<Balance | null>(null);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null), [txEntries, setTxEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [records, setRecords] = useState<RequestRecord[]>([]), [recordId, setRecordId] = useState<number | null>(null);
  const [preset, setPreset] = useState<Operation | null>(null), [draftPath, setDraftPath] = useState('/v1/transactions'), [draftMethod, setDraftMethod] = useState<'GET' | 'POST'>('POST'), [draftBody, setDraftBody] = useState('{}');
  const [lastSent, setLastSent] = useState<DemoRequest | null>(null), [copied, setCopied] = useState(false);
  const [scenario, setScenario] = useState<number | null>(null), [step, setStep] = useState(0);
  const [from, setFrom] = useState('wallet:alice'), [to, setTo] = useState('wallet:bob'), [amount, setAmount] = useState('25.00'), [reference, setReference] = useState(ref);
  const [reportFrom, setReportFrom] = useState(new Date(Date.now() - 7 * 86400000).toISOString()), [reportAsOf, setReportAsOf] = useState(new Date().toISOString());
  const [expirationAsOf, setExpirationAsOf] = useState('');
  const [beforeAfter, setBeforeAfter] = useState<{ before: Account[]; after: Account[] } | null>(null);
  const initialized = useRef(false);
  const refreshVersion = useRef(0);
  const inspectionVersion = useRef(0);
  const balanceController = useRef<AbortController | null>(null);
  const refreshRef = useRef<() => Promise<Account[] | undefined>>(async () => undefined);
  const currency = accounts[0]?.currency ?? (ledgers.find(l => l.id === ledger)?.name.startsWith('EUR') ? 'EUR' : 'USD');
  const scale = session?.assets.find(a => a.code === currency)?.scale ?? 2;
  const context: Context = { ledger, currency, accounts, ...ids, expirationAsOf };
  const journal = records.find(r => r.id === recordId) ?? records[0];

  useEffect(() => observeRequests(record => { setRecords(old => [record, ...old].slice(0, 150)); if (record.foreground) setRecordId(record.id); }), []);

  const bootstrap = useCallback(async (fresh: boolean) => {
    setBusy(true); setError(null);
    if (fresh) { balanceController.current?.abort(); refreshVersion.current++; }
    try {
      let s: Session;
      if (fresh) s = await request<Session>({ method: 'POST', path: '/demo/session' });
      else {
        try { s = await request<Session>({ method: 'GET', path: '/demo/session' }); }
        catch (e) { if (e instanceof Error && 'status' in e && e.status === 401) s = await request<Session>({ method: 'POST', path: '/demo/session' }); else throw e; }
      }
      setSelectedAccount(''); setBalance(null); setAccounts([]);
      setAccessToken(s.access_token); setSession(s); setIds(initialIds); setExpirationAsOf(''); setSelectedTx(null); setTxEntries([]); setBeforeAfter(null); setLastSent(null); setPreset(null); setScenario(null); setRecordId(null);
      const books = await allPages<Ledger>('/v1/ledgers?limit=200'); setLedgers(books); setLedger(books[0]?.id ?? '');
    } catch (e) { setError(describe(e)); } finally { setBusy(false); }
  }, []);
  useEffect(() => { if (initialized.current) return; initialized.current = true; void bootstrap(false); }, [bootstrap]);
  useEffect(() => {
    if (!session) return;
    const interval = window.setInterval(() => { void request<Session>({ method: 'GET', path: '/demo/session' }).then(s => { setAccessToken(s.access_token); setSession(s); }).catch(e => setError(describe(e))); }, Math.max(10000, (session.expires_in - 60) * 1000));
    return () => window.clearInterval(interval);
  }, [session]);

  const refresh = useCallback(async () => {
    if (!ledger) return;
    const version = ++refreshVersion.current;
    let a: Account[], t: Page<Transaction>, h: Page<Hold>;
    try {
      [a, t, h] = await Promise.all([
        allPages<Account>(query('/v1/accounts', { ledger_id: ledger, limit: 200 })),
        request<Page<Transaction>>({ method: 'GET', path: query('/v1/transactions', { ledger_id: ledger, limit: 10, ...(txFilter ? { where: pretty({ reference: { eq: txFilter } }) } : {}) }) }),
        request<Page<Hold>>({ method: 'GET', path: query('/demo/session/holds', { ledger_id: ledger, limit: 25 }) }),
      ]);
    } catch (e) { if (version !== refreshVersion.current) return; throw e; }
    if (version !== refreshVersion.current) return;
    setAccounts(a); setTransactions(t.data); setTxCursor(t.next_cursor); setHolds(h.data); setHoldCursor(h.next_cursor);
    setSelectedAccount(old => a.some(x => x.id === old) ? old : a.find(x => x.code === 'DEMO_PRIMARY' || x.name === 'wallet:alice')?.id ?? a[0]?.id ?? '');
    setFrom(old => a.some(x => x.name === old) ? old : a.find(x => x.code === 'DEMO_PRIMARY' || x.name === 'wallet:alice')?.name ?? '');
    setTo(old => a.some(x => x.name === old) ? old : a.find(x => x.code === 'DEMO_SECONDARY' || x.name === 'wallet:bob')?.name ?? '');
    return a;
  }, [ledger, txFilter]);
  refreshRef.current = refresh;
  useEffect(() => { setAccounts([]); setTransactions([]); setHolds([]); setSelectedAccount(''); setBalance(null); setIds(initialIds); setExpirationAsOf(''); setSelectedTx(null); setTxEntries([]); setPreset(null); setBeforeAfter(null); setLastSent(null); setReference(ref()); }, [ledger]);
  useEffect(() => { void refresh().catch(e => setError(describe(e))); }, [refresh]);
  useEffect(() => {
    setBalance(null);
    if (!accounts.some(account => account.id === selectedAccount && account.ledger_id === ledger && account.tenant_id === session?.tenant_id)) return;
    const controller = new AbortController();
    balanceController.current = controller;
    void request<Balance>({ method: 'GET', path: query(`/v1/accounts/${selectedAccount}/balance-as-of`, { at: new Date().toISOString() }) }, controller.signal)
      .then(setBalance).catch(e => { if (!controller.signal.aborted) setError(describe(e)); });
    return () => { controller.abort(); if (balanceController.current === controller) balanceController.current = null; };
  }, [selectedAccount, accounts, ledger, session?.tenant_id]);
  const execute = async (operation: DemoRequest): Promise<Json | undefined> => {
    setBusy(true); setError(null); setCopied(false);
    try {
      const result = await request<Json>(operation, undefined, true);
      const body = asObject(result);
      if (operation.path === '/v1/credit-grants/expiration/preview' && typeof operation.body?.as_of === 'string') setExpirationAsOf(operation.body.as_of);
      if (operation.method === 'POST' && operation.path.startsWith('/v1/')) {
        setLastSent(structuredClone(operation));
        setIds(old => ({ ...old,
          ...(typeof body.transaction_id === 'string' ? { tx: body.transaction_id } : {}),
          ...(typeof body.corrected_transaction_id === 'string' ? { tx: body.corrected_transaction_id } : {}),
          ...(typeof body.hold_id === 'string' ? { hold: body.hold_id } : {}),
          ...(operation.path === '/v1/credit-grants' && typeof body.id === 'string' ? { grant: body.id } : {}),
          ...(typeof body.upload_id === 'string' ? { upload: body.upload_id } : {}),
          ...(operation.path === '/v1/reconciliation/matching-rules' && typeof body.id === 'string' ? { rule: body.id } : {}),
          ...(operation.path === '/v1/reconciliation/runs' && typeof body.id === 'string' && !operation.body?.dry_run ? { run: body.id } : {}),
        }));
        const after = await refreshRef.current();
        if (after) setBeforeAfter({ before: accounts, after });
        if (operation.path === '/v1/ledgers') setLedgers(await allPages<Ledger>('/v1/ledgers?limit=200'));
      }
      return result;
    } catch (e) { setError(describe(e)); return undefined; } finally { setBusy(false); }
  };
  const choose = (op: Operation) => {
    const draft = op.build(context, ref()); setPreset(op); setDraftPath(draft.path); setDraftMethod(draft.method); setDraftBody(pretty(draft.body ?? {}));
  };
  const switchArea = (next: Area) => { setArea(next); setPreset(null); setCopied(false); };
  const openOperation = (id: string) => { const op = operations.find(o => o.id === id)!; setArea(op.area); choose(op); };
  const submitDraft = async () => {
    try {
      const body = draftMethod === 'POST' && draftBody.trim() ? JSON.parse(draftBody) : undefined;
      if (body !== undefined && (body === null || Array.isArray(body) || typeof body !== 'object')) throw new Error('Request body must be a JSON object');
      await execute({ method: draftMethod, path: draftPath, ...(body ? { body } : {}) });
    } catch (e) { setError(describe(e)); }
  };
  const inspectTransaction = async (tx: Transaction) => {
    const version = ++inspectionVersion.current;
    setSelectedTx(tx); setIds(old => ({ ...old, tx: tx.id })); setTxEntries([]);
    try { const data = await allPages<Entry>(query('/v1/entries', { limit: 200, where: pretty({ transaction_id: { eq: tx.id } }) })); if (inspectionVersion.current === version) setTxEntries(data); } catch (e) { setError(describe(e)); }
  };
  const sendTransfer = async (hold = false) => {
    try {
      const minor = toMinor(amount, scale), source = accounts.find(a => a.name === from), target = accounts.find(a => a.name === to);
      if (!source || !target || source.id === target.id) throw new Error('Choose two different accounts');
      const operation: DemoRequest = { method: 'POST', path: hold ? '/v1/holds' : '/v1/transactions', body: {
        ledger_id: ledger, reference, currency, description: `${from} to ${to}`,
        ...(!hold ? { metadata: { order_id: reference, channel: 'web' } } : {}),
        entries: [{ account_id: source.id, signed_amount_minor: minor, currency }, { account_id: target.id, signed_amount_minor: `-${minor}`, currency }],
      } };
      const result = await execute(operation);
      if (result && !hold) {
        const id = asObject(result).transaction_id;
        if (typeof id === 'string') { const t = await request<Transaction>({ method: 'GET', path: `/v1/transactions/${id}` }); await inspectTransaction(t); }
      }
    } catch (e) { setError(describe(e)); }
  };
  const moreTransactions = async () => {
    if (!txCursor) return;
    const result = await execute({ method: 'GET', path: query('/v1/transactions', { ledger_id: ledger, limit: 10, cursor: txCursor, ...(txFilter ? { where: pretty({ reference: { eq: txFilter } }) } : {}) }) });
    if (result) { const page = result as unknown as Page<Transaction>; setTransactions(old => [...old, ...page.data]); setTxCursor(page.next_cursor); }
  };
  const walletAccounts = accounts.filter(a => a.name.startsWith('wallet:') && !a.grant_enabled);
  const availableAccount = accounts.find(a => a.id === selectedAccount);
  const baseCreditAccount = accounts.find(a => a.code === 'DEMO_CREDITS' || a.name === 'credits:alice')?.id ?? selectedAccount;
  const reportQuery = { from: reportFrom, as_of: reportAsOf, limit: 25 };

  return <main>
    <header><a className="brand" href="/"><span className="mark">L</span>LuxLedger</a><nav>
      <a href="https://github.com/Crusader4Christ/LuxLedger" target="_blank" rel="noreferrer">GitHub ↗</a><a href="/docs?demo=1" target="_blank" rel="noreferrer">API docs ↗</a>
    </nav></header>
    <section className="hero"><p className="eyebrow">OPEN-SOURCE FINANCIAL INFRASTRUCTURE</p><h1>The ledger layer for products that move money.</h1><p className="hero-copy">Build wallets, marketplaces, payouts, and stored-value products without maintaining double-entry invariants in application code.</p>
      <div className="hero-actions"><a className="button-link primary" href="#flows">Try the live demo</a><a className="button-link secondary" href="mailto:herman.klushin@gmail.com?subject=LuxLedger%20design%20partnership">Become a design partner</a></div>
      <p className="hero-note">Built for Node.js teams · PostgreSQL-backed · Framework-agnostic core</p>
    </section>
    <div className="proof-strip hero-proof"><div><strong>Atomic</strong><span>postings, holds and bulk rollback</span></div><div><strong>Idempotent</strong><span>safe retries by reference</span></div><div><strong>Auditable</strong><span>reversals, history and statements</span></div><div><strong>Reconciled</strong><span>provider matching and reports</span></div></div>
    <section className="flow-guide" id="flows" aria-label="Guided demo flows">
      <div className="flow-guide-heading"><div className="section-intro compact"><p className="eyebrow">GUIDED DEMO</p><h2>Explore real ledger flows.</h2><p>Choose a workflow to open its first API request. Follow the steps, edit the payloads and inspect each result.</p></div><a href="#workspace">Open workspace <span aria-hidden="true">↗</span></a></div>
      <div className="scenario-grid">{scenarios.map((s, i) => <button className="scenario-card" disabled={!session || busy} key={s.name} onClick={() => { setScenario(i); setStep(0); openOperation(s.steps[0]); document.getElementById('workspace')?.scrollIntoView({ behavior: 'smooth' }); }}><span className="scenario-number">0{i + 1} <span>↗</span></span><h3>{s.name}</h3><p>{s.summary}</p><small>{s.steps.length} steps · editable requests</small></button>)}</div>
      <p className="flow-primer"><strong>Reading the ledger</strong><span>From the platform's perspective, customer wallets are CREDIT-normal liabilities. Positive entries are debits; negative entries are credits. Debiting a wallet lowers its displayed balance. Amounts use integer strings in minor units.</span></p>
    </section>
    <section className="workspace-shell" id="workspace" aria-label="Live demo workspace">
    {error && <div className="error" role="alert">{error}<button aria-label="Dismiss error" onClick={() => setError(null)}>×</button></div>}
    <div className="workspace-top"><div className="workspace-heading"><p className="eyebrow">LIVE DEMO · v0.5.0</p><h2>Ledger workspace</h2><div className="sandbox-line"><p className="workspace-session"><span className={`status-dot ${session ? 'online' : ''}`} />{session ? 'Sandbox ready · private tenant' : error ? 'Sandbox unavailable' : 'Connecting to sandbox…'}</p><button className="secondary" disabled={busy} title={session ? 'Create a fresh private demo with new accounts and balances. You will lose access to this sandbox; its history is retained.' : 'Create a private demo tenant with sample accounts and balances.'} onClick={() => void bootstrap(true)}>{session ? 'New sandbox' : 'Start sandbox'}</button></div></div></div>
    <div className="workspace-controls"><div className="workspace-ledger"><label htmlFor="workspace-ledger">Active ledger</label><select id="workspace-ledger" aria-label="Ledger" aria-describedby="ledger-currency-note" value={ledger} disabled={busy} onChange={e => { setLedger(e.target.value); setTxFilter(''); }}>{ledgers.map(l => <option value={l.id} key={l.id}>{l.name}</option>)}</select></div></div>
    <p className="ledger-currency-note" id="ledger-currency-note"><strong>Demo limitation:</strong> one currency per ledger (USD or EUR). The library supports mixed-currency accounts in one ledger, but each transaction or hold uses one currency. Cross-currency transfers and FX conversion are not available.</p>
    <nav className="tabs" aria-label="Workspace sections">{areas.map(name => <button key={name} aria-current={area === name ? 'page' : undefined} onClick={() => switchArea(name)}>{name}</button>)}</nav>

    {scenario !== null && <section className="scenario-banner"><div><span className="eyebrow">GUIDED SCENARIO · {step + 1}/{scenarios[scenario].steps.length}</span><h2>{scenarios[scenario].name}</h2><p>{operations.find(o => o.id === scenarios[scenario].steps[step])?.help}</p></div><div className="actions">
      <button className="secondary" disabled={busy} onClick={() => openOperation(scenarios[scenario].steps[step])}>Open current step</button>
      <button className="primary" disabled={busy || step >= scenarios[scenario].steps.length - 1} onClick={() => { const next = step + 1; setStep(next); openOperation(scenarios[scenario].steps[next]); }}>Next step →</button>
      <button className="text-button" onClick={() => setScenario(null)}>Exit guide</button></div></section>}

    {area === 'Accounts' && <>
      <section className="panel"><div className="panel-title"><h2>Chart of accounts</h2><span>{accounts.length} accounts · all cursor pages loaded</span></div><div className="account-grid">{accounts.map(a => <button className={`account-card ${selectedAccount === a.id ? 'selected' : ''}`} key={a.id} data-testid={`account-${a.name}`} onClick={() => setSelectedAccount(a.id)}><div><span className="badge">{a.side}</span>{a.grant_enabled && <span className="badge credit">GRANT</span>}</div><h3>{a.name}</h3><b>{money((a.side === 'CREDIT' ? -BigInt(a.balance_minor) : BigInt(a.balance_minor)).toString(), a.currency, scale)}</b><small>{a.overdraft_policy} overdraft</small><code>{a.id}</code></button>)}</div></section>
      {balance && <section className="balance-strip"><div><span>Selected</span><strong>{availableAccount?.name}</strong></div><div><span>Posted · canonical sign</span><strong>{money(balance.posted_minor, currency, scale)}</strong></div><div><span>Reserved delta</span><strong>{money(balance.reserved_delta_minor, currency, scale)}</strong></div><div><span>Available</span><strong data-testid="available-balance">{money(balance.available_minor, currency, scale)}</strong></div></section>}
      <ReadPanel title="Account directory" path={query('/v1/accounts', { ledger_id: ledger, limit: 25 })} execute={execute} busy={busy} />
    </>}

    {area === 'Transactions' && <>
      <section className="grid"><form className="panel transfer" onSubmit={e => { e.preventDefault(); void sendTransfer(); }}><div className="panel-title"><h2>New transfer</h2><span>{currency} · double-entry</span></div>
        <label>From<select value={from} onChange={e => setFrom(e.target.value)}>{walletAccounts.map(a => <option key={a.id}>{a.name}</option>)}</select></label>
        <label>To<select value={to} onChange={e => setTo(e.target.value)}>{walletAccounts.map(a => <option key={a.id}>{a.name}</option>)}</select></label>
        <label>Amount<input aria-label="Transfer amount" value={amount} inputMode="decimal" onChange={e => setAmount(e.target.value)} /></label>
        <label>Reference<input aria-label="Transfer reference" value={reference} onChange={e => setReference(e.target.value)} /></label>
        <div className="actions"><button className="primary" disabled={busy || !session}>Send transfer</button><button type="button" className="secondary" disabled={busy || !session} onClick={() => void sendTransfer(true)}>Reserve transfer</button><button type="button" className="text-button" onClick={() => setReference(ref())}>New reference</button></div></form>
        <div className="panel"><p className="eyebrow">RETRIES YOU CAN SEE</p><h2>One reference. One posting.</h2><p>Send a transfer twice with the same reference and payload. The first returns 201; the repeat returns 200 and created: false.</p><p>Change the amount while keeping the reference to inspect a payload mismatch. The original posting remains unchanged.</p><p className="muted">Reversal and correction work on the transaction selected below.</p></div></section>
      <section className="panel ledger"><div className="panel-title"><h2>Transactions</h2><span>10 per page · select to inspect</span></div><label>Exact reference filter<input placeholder="All references" value={txFilter} onChange={e => setTxFilter(e.target.value)} /></label>
        {transactions.map(t => <button className={`transaction-row ${ids.tx === t.id ? 'selected' : ''}`} key={t.id} onClick={() => void inspectTransaction(t)}><div><strong>{t.description ?? t.reference}</strong><code>{t.reference}</code></div><span>{t.relation_type ?? 'POSTING'}</span><time>{new Date(t.effective_at).toLocaleString()}</time><span>↗</span></button>)}
        {!transactions.length && <p className="muted">No matching transactions.</p>}{txCursor && <button className="secondary" disabled={busy} onClick={() => void moreTransactions()}>Load more transactions</button>}
      </section>
      {selectedTx && <section className="panel ledger"><div className="panel-title"><h2>How LuxLedger recorded it</h2><span>{selectedTx.reference}</span></div><p><code>{selectedTx.id}</code></p><p>Effective: {selectedTx.effective_at} · Created: {selectedTx.created_at}</p>
        {selectedTx.related_transaction_id && <p>{selectedTx.relation_type} → <code>{selectedTx.related_transaction_id}</code></p>}
        {txEntries.map(e => { const d = toEntryDisplay(e.signed_amount_minor); return <div className="entry" key={e.id}><span className={`badge ${d?.direction.toLowerCase()}`}>{d?.direction}</span><strong>{accounts.find(a => a.id === e.account_id)?.name ?? e.account_id}</strong><span>{money(d?.magnitudeMinor ?? '0', e.currency, scale)}</span></div>; })}
        <p className="balanced">{entriesAreBalanced(txEntries) ? '✓ Debits and credits balance' : 'Loading entries…'}</p><details><summary>Metadata</summary><JsonBlock value={selectedTx.metadata} /></details>
      </section>}
    </>}

    {area === 'Holds' && <section className="panel" aria-label="Transfer holds"><div className="panel-title"><h2>Payment authorizations</h2><span>25 per page</span></div>
      {!holds.length && <p>No holds yet. Reserve a payment to begin.</p>}{holds.map(h => <article className={`hold-row ${ids.hold === h.id ? 'selected' : ''}`} key={h.id}><div><strong>{h.description ?? h.reference}</strong><code>{h.reference}</code></div><span className="badge">{h.state}</span><span>{money(h.original_amount_minor, currency, scale)} / remaining {money(h.remaining_amount_minor, currency, scale)}</span><button className="secondary" onClick={() => setIds(old => ({ ...old, hold: h.id }))}>Select hold</button></article>)}
      {holdCursor && <button className="secondary" disabled={busy} onClick={async () => { const result = await execute({ method: 'GET', path: query('/demo/session/holds', { ledger_id: ledger, limit: 25, cursor: holdCursor }) }); if (result) { const p = result as unknown as Page<Hold>; setHolds(old => [...old, ...p.data]); setHoldCursor(p.next_cursor); } }}>Load more holds</button>}
      <p>Selected hold: <code>{ids.hold || 'Create or select one'}</code></p>
    </section>}

    {area === 'Credits' && <>
      <section className="panel"><p className="eyebrow">PREPAID CAPACITY</p><h2>From issuance to consumption.</h2><p>Issue multiple grants, spend from the promotional account, then inspect which lots funded each entry. Holds reserve capacity; refunds and expiration operate on the remaining eligible capacity.</p>
        <label>Selected grant ID<input aria-label="Selected grant ID" value={ids.grant} placeholder="Issue a grant or paste an ID from the directory" onChange={e => setIds(old => ({ ...old, grant: e.target.value }))} /></label>
        <p className="muted">A full reversal requires an untouched grant. Refunds cannot return consumed, expired or actively reserved capacity.</p></section>
      <div className="read-grid"><ReadPanel title="Credit balance" path={`/v1/accounts/${baseCreditAccount}/credit-balance`} execute={execute} busy={busy} /><ReadPanel title="Credit lots" path={`/v1/accounts/${baseCreditAccount}/credit-lots?limit=25`} execute={execute} busy={busy} /></div>
      <ReadPanel title="Grant directory" path={query('/v1/credit-grants', { account_id: baseCreditAccount, limit: 25 })} execute={execute} busy={busy} />
    </>}

    {area === 'Reconciliation' && <>
      <section className="panel"><p className="eyebrow">PROVIDER STATEMENT ↔ LEDGER</p><h2>Make differences explainable.</h2><p>Create rules, upload normalized records, preview matching and persist a report. Review matched, mismatched, unmatched external/internal and conflict results.</p>
        <div className="field-grid">{(['upload', 'rule', 'run'] as const).map(key => <label key={key}>{key} ID<input aria-label={`${key} ID`} value={ids[key]} placeholder="Filled by the corresponding API response" onChange={e => setIds(old => ({ ...old, [key]: e.target.value }))} /></label>)}</div>
        <p className="muted">Matching strategy: one_to_one. Use amount_tolerance_minor and date_tolerance_seconds inside rule criteria. CSV import is converted locally to the documented JSON request.</p></section>
      <ReadPanel title="Matching rules" path="/v1/reconciliation/matching-rules?limit=25" execute={execute} busy={busy} />
      {ids.run && <><ReadPanel title="Run report" path={`/v1/reconciliation/runs/${ids.run}`} execute={execute} busy={busy} /><ReadPanel title="Reconciliation results" path={`/v1/reconciliation/runs/${ids.run}/results?limit=25`} execute={execute} busy={busy} /></>}
    </>}

    {area === 'Reports' && <>
      <section className="panel"><div className="panel-title"><h2>Reporting boundaries</h2><span>Explicit, stable time windows</span></div><div className="field-grid"><label>Account<select aria-label="Report account" value={selectedAccount} onChange={e => setSelectedAccount(e.target.value)}>{accounts.map(a => <option value={a.id} key={a.id}>{a.name}</option>)}</select></label><label>From · ISO timestamp<input value={reportFrom} onChange={e => setReportFrom(e.target.value)} /></label><label>As of · ISO timestamp<input value={reportAsOf} onChange={e => setReportAsOf(e.target.value)} /></label></div>
        <button className="text-button" onClick={() => setReportAsOf(new Date().toISOString())}>Set as of to now</button><p className="muted">Opening includes events at from; movements cover (from, as_of]. Reconcile opening + deltas = closing across all pages. Credit capacity uses creation time; account history uses effective time.</p></section>
      <ReadPanel title="Historical balance" path={query(`/v1/accounts/${selectedAccount}/balance-as-of`, { at: reportAsOf })} execute={execute} busy={busy} />
      <ReadPanel title="Balance history" path={query(`/v1/accounts/${selectedAccount}/balance-history`, { from: reportFrom, to: reportAsOf, limit: 25 })} execute={execute} busy={busy} />
      <ReadPanel title="Account statement" path={query(`/v1/accounts/${selectedAccount}/statement`, reportQuery)} execute={execute} busy={busy} />
      <ReadPanel title="Credit statement" path={query(`/v1/accounts/${baseCreditAccount}/credit-statement`, { ...reportQuery, ...(ids.grant ? { grant_id: ids.grant } : {}) })} execute={execute} busy={busy} />
      <ReadPanel title="Trial balance" path={`/v1/ledgers/${ledger}/trial-balance`} execute={execute} busy={busy} />
    </>}

    {area !== 'Reports' && <section className="panel workbench"><div className="panel-title"><h2>Operation workbench</h2><span>Real payloads · editable JSON</span></div>
      <div className="operation-grid">{operations.filter(o => o.area === area).map(o => <button key={o.id} className={`operation-chip ${preset?.id === o.id ? 'selected' : ''}`} disabled={!session || busy} onClick={() => choose(o)}>{o.title}</button>)}</div>
      {preset && <><div className="workbench-intro"><h3>{preset.title}</h3><p>{preset.help}</p></div><div className="request-editor-line"><select aria-label="Request method" value={draftMethod} onChange={e => setDraftMethod(e.target.value as 'GET' | 'POST')}><option>POST</option><option>GET</option></select><input aria-label="Request path" value={draftPath} onChange={e => setDraftPath(e.target.value)} /></div>
        {draftMethod === 'POST' && <label>Request JSON<textarea aria-label="Request JSON" value={draftBody} onChange={e => setDraftBody(e.target.value)} rows={17} spellCheck={false} /></label>}
        {preset.id === 'upload' && <label>Import statement CSV<input type="file" accept=".csv,text/csv" onChange={async e => {
          const file = e.target.files?.[0]; if (!file) return;
          try {
            const { parseStatementCsv } = await import('./csv');
            setDraftBody(pretty({ source: file.name, records: parseStatementCsv(await file.text()) }));
          } catch (cause) { setError(describe(cause)); }
          e.target.value = '';
        }} /><small>Headers: id, amount_minor, currency, reference, date, description (optional). Quoted CSV fields are supported.</small></label>}
        <div className="actions"><button className="primary" disabled={busy || !session} onClick={() => void submitDraft()}>{busy ? 'Sending…' : 'Send request'}</button><button className="secondary" disabled={busy} onClick={() => choose(preset)}>{preset.id === 'expiration-preview' ? 'Refresh preview timestamp' : preset.id === 'expiration-run' ? 'Use latest preview timestamp' : 'Regenerate with new reference'}</button><a className="text-button" href={`/docs?demo=1&filter=${encodeURIComponent(draftPath.split('?')[0].split('/').slice(0, 3).join('/'))}`} target="_blank" rel="noreferrer">View API docs ↗</a></div>
      </>}
    </section>}

    {beforeAfter && <details className="panel ledger"><summary>Balance changes from the last successful write</summary><div className="table-scroll"><table><thead><tr><th>Account</th><th>Before</th><th>After</th><th>Delta · canonical sign</th></tr></thead><tbody>{beforeAfter.after.map(a => { const before = beforeAfter.before.find(b => b.id === a.id)?.balance_minor ?? '0'; return <tr key={a.id}><td>{a.name}</td><td>{money(before, currency, scale)}</td><td>{money(a.balance_minor, currency, scale)}</td><td>{money((BigInt(a.balance_minor) - BigInt(before)).toString(), currency, scale)}</td></tr>; })}</tbody></table></div></details>}

    <section className="panel request-preview" aria-label="Request journal"><div className="panel-title"><h2>Request journal</h2><span>{records.length} / 150 latest · credentials redacted</span></div><div className="journal-layout"><div className="journal-list">{records.map(r => <button className={journal?.id === r.id ? 'selected' : ''} key={r.id} onClick={() => { setRecordId(r.id); setCopied(false); }}><span className={`http-status ${r.status >= 400 || r.status === 0 ? 'failed' : ''}`}>{r.status || 'ERR'}</span><strong>{r.request.method}</strong><code>{r.request.path}</code></button>)}</div><div className="journal-detail">{journal ? <><div className="request-line"><span>{journal.request.method}</span><code>{journal.request.path}</code><b className={journal.status >= 400 ? 'text-error' : ''}>{journal.status}</b><small>{journal.duration} ms</small></div><p className="muted">Request ID: <code>{journal.requestId ?? 'unavailable'}</code></p>
        {journal.request.body && <><h3>Request</h3><pre data-testid="request-body">{pretty(journal.request.body)}</pre></>}
        <h3>Response</h3><JsonBlock value={journal.response} /><div className="curl-header"><strong>Run from your terminal</strong><button className="secondary" onClick={() => { void copyText(requestToCurl(journal.request, window.location.origin)).then(() => setCopied(true)).catch(e => setError(describe(e))); }}>{copied ? 'Copied' : 'Copy curl'}</button></div><pre data-testid="curl-preview">{requestToCurl(journal.request, window.location.origin)}</pre>
        <div className="actions">{journal.request.path.startsWith('/v1/') && <button className="secondary" disabled={busy} onClick={() => void execute(journal.request)}>Repeat exact request</button>}{lastSent && <button className="text-button" disabled={busy} onClick={() => void execute(lastSent)}>Repeat last write</button>}</div><p className="muted">cURL uses $ACCESS_TOKEN. The browser keeps the sandbox token in memory; session credentials are HttpOnly. Financial requests and responses match the public API.</p>
      </> : <p className="muted">Requests appear here as you explore.</p>}</div></div></section>
    </section>
    <footer><div className="brand"><span className="mark">L</span>LuxLedger</div><p>Open-source double-entry ledger infrastructure.</p><div><a href="/docs?demo=1" target="_blank" rel="noreferrer">API docs</a><a href="/openapi.yaml" target="_blank" rel="noreferrer">OpenAPI</a></div></footer>
  </main>;
}

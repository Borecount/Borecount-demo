import { money } from './api';
import { AccountsSection } from './components/AccountsSection';
import { CreditsSection } from './components/CreditsSection';
import { ExecutionJournal } from './components/ExecutionJournal';
import { HoldsSection } from './components/HoldsSection';
import { OperationWorkbench } from './components/OperationWorkbench';
import { ReconciliationSection } from './components/ReconciliationSection';
import { ReportsSection } from './components/ReportsSection';
import { TransactionsSection } from './components/TransactionsSection';
import { apiVersion } from './generated-contract';
import { useExecutionMode } from './hooks/useExecutionMode';
import { useJournal } from './hooks/useJournal';
import { useReportWindow } from './hooks/useReportWindow';
import { useSandbox } from './hooks/useSandbox';
import { useWorkflow } from './hooks/useWorkflow';
import { operations, type Area } from './operations';
import { scenarios } from './workflows';

const areas: Area[] = ['Accounts', 'Transactions', 'Holds', 'Credits', 'Reconciliation', 'Reports'];

export function App() {
  const executionMode = useExecutionMode();
  const { mode } = executionMode;
  const sandbox = useSandbox(mode);
  const journal = useJournal(sandbox.session?.tenant_id);
  const reportWindow = useReportWindow();
  const workflow = useWorkflow(mode, sandbox);
  const {
    session,
    ledgers,
    ledger,
    setLedger,
    setTxFilter,
    busy,
    error,
    setError,
    beforeAfter,
    lastSent,
    currency,
    scale,
    bootstrap,
    execute,
  } = sandbox;
  const { area, switchArea, scenario, setScenario, step, setStep, openOperation } = workflow;
  const switchMode = (next: typeof mode) =>
    executionMode.switchMode(next, {
      busy,
      translateDraft: workflow.translateDraft,
      invalidateReads: sandbox.invalidateReads,
      setError,
    });
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

        {area === 'Accounts' && <AccountsSection mode={mode} sandbox={sandbox} />}

        {area === 'Transactions' && <TransactionsSection mode={mode} sandbox={sandbox} />}

        {area === 'Holds' && <HoldsSection mode={mode} sandbox={sandbox} />}

        {area === 'Credits' && <CreditsSection mode={mode} sandbox={sandbox} />}

        {area === 'Reconciliation' && session && ledger && (
          <ReconciliationSection mode={mode} sandbox={sandbox} workflow={workflow} />
        )}

        {area === 'Reports' && (
          <ReportsSection mode={mode} sandbox={sandbox} reportWindow={reportWindow} />
        )}

        {area !== 'Reports' && (
          <OperationWorkbench mode={mode} sandbox={sandbox} workflow={workflow} />
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
          records={journal.records}
          selectedRecord={journal.selectedRecord}
          onSelect={journal.select}
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

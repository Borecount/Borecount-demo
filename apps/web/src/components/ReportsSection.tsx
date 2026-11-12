import { query, type DemoMode } from '../api';
import type { ReportWindow } from '../hooks/useReportWindow';
import type { Sandbox } from '../hooks/useSandbox';
import { ReadPanel } from './ReadPanel';

type Props = {
  reportWindow: ReportWindow;
  mode: DemoMode;
  sandbox: Pick<
    Sandbox,
    | 'ledger'
    | 'accounts'
    | 'ids'
    | 'selectedAccount'
    | 'setSelectedAccount'
    | 'busy'
    | 'execute'
    | 'baseCreditAccount'
  >;
};

export function ReportsSection({ mode, sandbox, reportWindow }: Props) {
  const {
    ledger,
    accounts,
    ids,
    selectedAccount,
    setSelectedAccount,
    busy,
    execute,
    baseCreditAccount,
  } = sandbox;
  const { reportFrom, setReportFrom, reportAsOf, setReportAsOf, reportQuery } = reportWindow;
  return (
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
        <button className="text-button" onClick={() => setReportAsOf(new Date().toISOString())}>
          Set as of to now
        </button>
        <p className="muted">
          Opening includes events at from; movements cover (from, as_of]. Reconcile opening + deltas
          = closing across all pages. Credit capacity uses creation time; account history uses
          effective time.
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
  );
}

import { query, type DemoMode } from '../api';
import type { Sandbox } from '../hooks/useSandbox';
import type { Workflow } from '../hooks/useWorkflow';
import { ReadPanel } from './ReadPanel';
import { ReconciliationHistory } from './ReconciliationHistory';

type Props = {
  mode: DemoMode;
  sandbox: Pick<
    Sandbox,
    'session' | 'ledger' | 'ids' | 'reconciliationHistoryRevision' | 'busy' | 'execute'
  >;
  workflow: Pick<Workflow, 'selectReconciliationId'>;
};

export function ReconciliationSection({ mode, sandbox, workflow }: Props) {
  const { session, ledger, ids, reconciliationHistoryRevision, busy, execute } = sandbox;
  const { selectReconciliationId } = workflow;
  if (!session || !ledger) return null;
  return (
    <>
      <section className="panel">
        <p className="eyebrow">PROVIDER STATEMENT ↔ LEDGER</p>
        <h2>Make differences explainable.</h2>
        <p>
          Create rules, upload normalized records, preview matching and persist a report. Review
          matched, mismatched, unmatched external/internal and conflict results.
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
          Selecting an ID closes the current request draft. Choose an operation to use the selected
          IDs. Matching strategy: one_to_one. Use amount_tolerance_minor and date_tolerance_seconds
          inside rule criteria.{' '}
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
  );
}

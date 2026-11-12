import { toLibraryCall, type DemoMode } from '../api';
import type { Sandbox } from '../hooks/useSandbox';
import type { Workflow } from '../hooks/useWorkflow';
import { operations } from '../operations';
import { errorMessage, formatJson } from '../workspace-utils';
import { LibraryPreview } from './LibraryPreview';

type Props = {
  mode: DemoMode;
  sandbox: Pick<Sandbox, 'session' | 'busy' | 'setError'>;
  workflow: Pick<
    Workflow,
    | 'area'
    | 'preset'
    | 'choose'
    | 'draftMethod'
    | 'setDraftMethod'
    | 'draftPath'
    | 'setDraftPath'
    | 'draftBody'
    | 'setDraftBody'
    | 'libraryDraft'
    | 'setLibraryDraft'
    | 'submitDraft'
  >;
};

export function OperationWorkbench({ mode, sandbox, workflow }: Props) {
  const { session, busy, setError } = sandbox;
  const {
    area,
    preset,
    choose,
    draftMethod,
    setDraftMethod,
    draftPath,
    setDraftPath,
    draftBody,
    setDraftBody,
    libraryDraft,
    setLibraryDraft,
    submitDraft,
  } = workflow;
  return (
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
                Edit structured arguments. Amounts become bigint and timestamps become Date values.
                The server supplies your sandbox tenant and actor.
              </p>
              <LibraryPreview
                call={() => ({
                  operation: toLibraryCall({ method: draftMethod, path: draftPath }).operation,
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
                    const { parseStatementCsv } = await import('../csv');
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
                Headers: id, amount_minor, currency, reference, date, description (optional). Quoted
                CSV fields are supported.
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
  );
}

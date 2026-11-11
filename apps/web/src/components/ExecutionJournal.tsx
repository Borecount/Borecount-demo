import { useEffect, useState } from 'react';
import {
  libraryCode,
  requestToCurl,
  type DemoMode,
  type DemoRequest,
  type Json,
  type RequestRecord,
  type Session,
} from '../api';
import { JsonBlock } from './DataView';
import { LibraryPreview } from './LibraryPreview';

interface ExecutionJournalProps {
  records: RequestRecord[];
  selectedRecord?: RequestRecord;
  onSelect: (id: number) => void;
  onExecute: (operation: DemoRequest) => Promise<Json | undefined>;
  lastWrite: DemoRequest | null;
  mode: DemoMode;
  session: Session | null;
  busy: boolean;
  onError: (message: string) => void;
}

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return;
  } catch {
    // Embedded demos can lack clipboard permission. The temporary textarea also
    // supports browsers that expose copy through execCommand only.
  }

  const input = document.createElement('textarea');
  input.value = value;
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.append(input);
  input.select();
  const copied = document.execCommand('copy');
  input.remove();

  if (!copied) {
    throw new Error('Clipboard unavailable. Select and copy the example.');
  }
}

function executionFailed(record: RequestRecord) {
  return record.status === 0 || record.status >= 400;
}

function recordStatus(record: RequestRecord) {
  if (record.mode === 'library') {
    return executionFailed(record) ? 'ERR' : 'OK';
  }
  return record.status || 'ERR';
}

export function ExecutionJournal({
  records,
  selectedRecord: record,
  onSelect,
  onExecute,
  lastWrite,
  mode,
  session,
  busy,
  onError,
}: ExecutionJournalProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => setCopied(false), [record?.id, mode]);

  // Replay the exact submitted arguments through the currently selected mode.
  // The server-returned call includes trusted/defaulted context for inspection,
  // while request.libraryCall holds the original caller input for safe replay.
  const repeat = (request: DemoRequest) => {
    const operation = { ...request };
    if (mode === 'rest') {
      delete operation.libraryCall;
    }
    void onExecute(operation);
  };

  // Successful records retain trusted tenant/actor context from the server.
  // Failed calls lack that context, so their examples use the current session.
  const tenantId = record?.call?.input.tenantId ?? session?.tenant_id;
  const actorId = record?.call?.input.actorId ?? session?.actor_id;
  const copyExample = async () => {
    if (!record) return;
    try {
      const example = record.call
        ? libraryCode(record.call, tenantId, actorId)
        : requestToCurl(record.request, window.location.origin);
      await copyText(example);
      setCopied(true);
    } catch (error) {
      // Code generation can fail for an invalid bigint/date in an error record.
      onError(error instanceof Error ? error.message : String(error));
    }
  };

  const isLibrary = record?.mode === 'library';
  const failed = record ? executionFailed(record) : false;
  const libraryCall = record?.call;
  let modeLabel = 'REST API';
  let resultTitle = 'Response';
  let detailStatus: string | number = record?.status ?? 'ERR';
  if (isLibrary) {
    modeLabel = 'Library';
    resultTitle = failed ? 'Library error' : 'Returned value';
    detailStatus = failed ? 'Failed' : 'Returned';
  } else if (record?.mode === 'host') {
    modeLabel = 'Sandbox session';
  }

  return (
    <section className="panel request-preview" aria-label="Request journal">
      <div className="panel-title">
        <h2>Execution journal</h2>
        <span>{records.length} / 150 latest · credentials redacted</span>
      </div>
      <div className="journal-layout">
        <div className="journal-list">
          {records.map((entry) => (
            <button
              className={record?.id === entry.id ? 'selected' : ''}
              key={entry.id}
              onClick={() => onSelect(entry.id)}
            >
              <span className={`http-status ${executionFailed(entry) ? 'failed' : ''}`}>
                {recordStatus(entry)}
              </span>
              <strong>
                {entry.mode === 'library'
                  ? 'Library'
                  : entry.mode === 'host'
                    ? 'Session'
                    : entry.request.method}
              </strong>
              <code>{entry.call?.operation ?? entry.request.path}</code>
            </button>
          ))}
        </div>
        <div className="journal-detail">
          {record ? (
            <>
              <div className="request-line">
                <span>{modeLabel}</span>
                <code>
                  {record.call
                    ? `services.${record.call.operation}`
                    : `${record.request.method} ${record.request.path}`}
                </code>
                <b className={executionFailed(record) ? 'text-error' : ''}>{detailStatus}</b>
                <small>{record.duration} ms</small>
              </div>
              <p className="muted">
                {isLibrary ? 'Execution ID' : 'Request ID'}{' '}
                <code>{record.requestId ?? 'unavailable'}</code>
              </p>
              {(record.call || record.request.body) && (
                <>
                  <h3>{record.call ? 'Arguments' : 'Request'}</h3>
                  <pre data-testid="request-body">
                    {JSON.stringify(record.call?.input ?? record.request.body, null, 2)}
                  </pre>
                </>
              )}
              <h3>{resultTitle}</h3>
              <JsonBlock value={record.response} />
              <div className="curl-header">
                <strong>
                  {record.call ? 'Use in your Node.js application' : 'Run from your terminal'}
                </strong>
                <button className="secondary" onClick={() => void copyExample()}>
                  {copied ? 'Copied' : record.call ? 'Copy TypeScript' : 'Copy curl'}
                </button>
              </div>
              {libraryCall ? (
                <LibraryPreview call={() => libraryCall} tenantId={tenantId} actorId={actorId} />
              ) : (
                <pre data-testid="curl-preview">
                  {requestToCurl(record.request, window.location.origin)}
                </pre>
              )}
              <div className="actions">
                {record.request.path.startsWith('/v1/') && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => repeat(record.request)}
                  >
                    {mode === 'rest' ? 'Repeat exact request' : 'Repeat in Library'}
                  </button>
                )}
                {lastWrite && (
                  <button className="text-button" disabled={busy} onClick={() => repeat(lastWrite)}>
                    Repeat last write
                  </button>
                )}
              </div>
              <p className="muted">
                {record.call
                  ? 'This call ran directly against Borecount services on the demo server. bigint and Date values are serialized as strings for display.'
                  : 'cURL uses $ACCESS_TOKEN. The browser keeps the sandbox token in memory; session credentials are HttpOnly.'}
              </p>
            </>
          ) : (
            <p className="muted">Executions appear here as you explore.</p>
          )}
        </div>
      </div>
    </section>
  );
}

import { useEffect, useRef, useState } from 'react';
import { toLibraryCall, toRestRequest, type DemoMode, type DemoRequest, type Json } from '../api';
import { DataTable, JsonBlock } from './DataView';

const pretty = (value: unknown) => JSON.stringify(value, null, 2);
const asObject = (value: Json): Record<string, Json> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function ReadPanel({
  title,
  path,
  busy,
  execute,
  mode,
}: {
  title: string;
  path: string;
  busy: boolean;
  mode: DemoMode;
  execute: (op: DemoRequest, signal?: AbortSignal) => Promise<Json | undefined>;
}) {
  const initialCall = () => {
    try {
      return toLibraryCall({ method: 'GET', path });
    } catch {
      return null;
    }
  };
  const [libraryInput, setLibraryInput] = useState(() => pretty(initialCall()?.input ?? {}));
  const [url, setUrl] = useState(path);
  const [result, setResult] = useState<Json>(null);
  const [where, setWhere] = useState('{}');
  const [continuation, setContinuation] = useState<string | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    setUrl(path);
    setResult(null);
    setContinuation(null);
    setWhere('{}');
    setLibraryInput(pretty(initialCall()?.input ?? {}));
    return () => activeRequest.current?.abort();
  }, [path]);
  // A continuation carries only the server cursor. Keep the edited arguments
  // and time boundaries stable while advancing through the same result set.
  const load = async (next = false) => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    try {
      const target = new URL(next && continuation ? continuation : url, window.location.origin);
      if (!next) {
        const filter = JSON.parse(where);
        if (Object.keys(filter).length) target.searchParams.set('where', JSON.stringify(filter));
        else target.searchParams.delete('where');
        target.searchParams.delete('cursor');
      }
      let operation: DemoRequest = { method: 'GET', path: target.pathname + target.search };
      if (mode === 'library') {
        const call = toLibraryCall({ method: 'GET', path });
        call.input = JSON.parse(libraryInput);
        if (next && continuation)
          call.input.cursor = new URL(continuation, window.location.origin).searchParams.get(
            'cursor',
          );
        // The descriptor feeds shared display/pagination controls. libraryCall
        // holds the actual service input that the selected executor submits.
        operation = { ...toRestRequest(call), libraryCall: call };
      }
      const value = await execute(operation, controller.signal);
      if (controller.signal.aborted || value === undefined) return;
      setResult(value);
      const body = asObject(value);
      if (typeof body.next_cursor === 'string') {
        target.searchParams.set('cursor', body.next_cursor);
        setContinuation(target.pathname + target.search);
      } else setContinuation(null);
    } catch (e) {
      if (!controller.signal.aborted) setResult({ error: describe(e) });
    }
  };
  const object = asObject(result);
  return (
    <section className="panel read-panel" aria-label={title}>
      <div className="panel-title">
        <h2>{title}</h2>
        <span>{mode === 'library' ? 'Library call' : 'Canonical API'}</span>
      </div>
      {mode === 'rest' ? (
        <>
          <label>
            Request URL
            <input
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setContinuation(null);
              }}
            />
          </label>
          <details className="filter-details">
            <summary>Server filters · where JSON</summary>
            <p className="muted">
              Use only fields allowed by this endpoint. Filters are ANDed. Metadata paths are
              excluded. See API docs for field schemas.
            </p>
            <textarea
              aria-label={`${title} filters`}
              value={where}
              onChange={(e) => {
                setWhere(e.target.value);
                setContinuation(null);
              }}
              rows={4}
              spellCheck={false}
            />
          </details>
        </>
      ) : (
        <>
          <p>
            <code>services.{initialCall()?.operation ?? 'Select a resource'}</code>
          </p>
          <label>
            Library arguments
            <textarea
              aria-label={`${title} library arguments`}
              value={libraryInput}
              onChange={(e) => {
                setLibraryInput(e.target.value);
                setContinuation(null);
              }}
              rows={6}
              spellCheck={false}
            />
          </label>
          <p className="muted">
            Arguments use camelCase. Amounts and dates are strings in this editor and become bigint
            and Date values on the server.
          </p>
        </>
      )}
      <div className="actions">
        <button className="primary" disabled={busy} onClick={() => void load()}>
          Load {title.toLowerCase()}
        </button>
        {continuation && (
          <button className="secondary" disabled={busy} onClick={() => void load(true)}>
            Next page
          </button>
        )}
      </div>
      {result !== null && (
        <>
          <div className="result-summary">
            {Array.isArray(object.data)
              ? `${object.data.length} records · ${continuation ? 'more pages available' : 'last page'}`
              : 'Response'}
          </div>
          {Array.isArray(object.data) ? (
            <>
              <DataTable rows={object.data as Record<string, Json>[]} />
              {Object.keys(object).some((k) => !['data', 'next_cursor'].includes(k)) && (
                <details>
                  <summary>Opening / closing totals and scope</summary>
                  <JsonBlock value={{ ...object, data: undefined }} />
                </details>
              )}
            </>
          ) : (
            <JsonBlock value={result} />
          )}
        </>
      )}
    </section>
  );
}

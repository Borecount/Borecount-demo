import { useCallback, useEffect, useRef, useState } from 'react';
import { request, type Json } from '../api';

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function ReconciliationHistory({
  title,
  path,
  idField,
  selectedId,
  onSelect,
  busy,
}: {
  title: string;
  path: string;
  idField: 'upload_id' | 'id';
  selectedId: string;
  onSelect: (id: string) => void;
  busy: boolean;
}) {
  const [page, setPage] = useState<Record<string, Json> | null>(null);
  const [nextPath, setNextPath] = useState<string | null>(null);
  const [pagePaths, setPagePaths] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const load = useCallback(
    async (requestedPath = path, previousPaths: string[] = []) => {
      activeRequest.current?.abort();
      const controller = new AbortController();
      activeRequest.current = controller;
      const target = new URL(requestedPath, window.location.origin);
      setLoading(true);
      try {
        const result = await request<Json>(
          { method: 'GET', path: target.pathname + target.search },
          controller.signal,
          false,
        );
        if (
          controller.signal.aborted ||
          !result ||
          typeof result !== 'object' ||
          Array.isArray(result)
        )
          return;
        const body = result as Record<string, Json>;
        setLoadError(null);
        setPage(body);
        setPagePaths([...previousPaths, requestedPath]);
        if (typeof body.next_cursor === 'string') {
          target.searchParams.set('cursor', body.next_cursor);
          setNextPath(target.pathname + target.search);
        } else setNextPath(null);
      } catch (error) {
        if (!controller.signal.aborted) setLoadError(describe(error));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [path],
  );
  useEffect(() => {
    setPage(null);
    setNextPath(null);
    setPagePaths([]);
    void load(path);
    return () => activeRequest.current?.abort();
  }, [load, path]);
  const rows = Array.isArray(page?.data)
    ? page.data.filter(
        (row): row is Record<string, Json> =>
          !!row && typeof row === 'object' && !Array.isArray(row),
      )
    : [];
  return (
    <section className="panel read-panel" aria-label={title}>
      <div className="panel-title">
        <h2>{title}</h2>
        <span>Newest first · select to reuse</span>
      </div>
      <div className="actions">
        <button className="secondary" disabled={busy || loading} onClick={() => void load(path)}>
          Refresh {title.toLowerCase()}
        </button>
        {pagePaths.length > 1 && (
          <button
            className="secondary"
            disabled={busy || loading}
            onClick={() => void load(pagePaths[pagePaths.length - 2], pagePaths.slice(0, -2))}
          >
            Previous page
          </button>
        )}
        {nextPath && (
          <button
            className="secondary"
            disabled={busy || loading}
            onClick={() => void load(nextPath, pagePaths)}
          >
            Next page
          </button>
        )}
      </div>
      {loadError && (
        <p className="error" role="alert">
          {loadError}
        </p>
      )}
      {page &&
        (rows.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Details</th>
                  <th>Created / started</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const id = row[idField];
                  return (
                    <tr key={String(id ?? index)}>
                      <td>
                        <code>{String(id ?? '—')}</code>
                      </td>
                      <td>
                        {idField === 'upload_id'
                          ? `${String(row.source ?? '')} · ${String(row.record_count ?? 0)} records`
                          : `${String(row.status ?? '')} · ${String(row.matched_count ?? 0)} matched`}
                      </td>
                      <td>{String(row.created_at ?? row.started_at ?? '—')}</td>
                      <td>
                        <button
                          className={selectedId === id ? 'primary' : 'secondary'}
                          disabled={typeof id !== 'string'}
                          onClick={() => typeof id === 'string' && onSelect(id)}
                        >
                          {selectedId === id ? 'Selected' : 'Select'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No {title.toLowerCase()}.</p>
        ))}
    </section>
  );
}

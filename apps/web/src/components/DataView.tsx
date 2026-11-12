import type { Json } from '../api';

const pretty = (value: unknown) => JSON.stringify(value, null, 2);

export function JsonBlock({ value }: { value: unknown }) {
  return <pre>{pretty(value)}</pre>;
}
export function DataTable({ rows }: { rows: Record<string, Json>[] }) {
  if (!rows.length) return <p className="muted">No records in this page.</p>;
  const columns = Object.keys(rows[0]);
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {columns.map((k) => (
              <th key={k}>{k}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={String(row.id ?? i)}>
              {columns.map((k) => (
                <td key={k}>
                  {typeof row[k] === 'object' ? pretty(row[k]) : String(row[k] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

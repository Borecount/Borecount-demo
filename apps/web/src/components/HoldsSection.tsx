import { money, query, type DemoMode, type Hold, type Page } from '../api';
import type { Sandbox } from '../hooks/useSandbox';

type Props = {
  mode: DemoMode;
  sandbox: Pick<
    Sandbox,
    | 'holds'
    | 'setHolds'
    | 'holdCursor'
    | 'setHoldCursor'
    | 'holdState'
    | 'setHoldState'
    | 'ids'
    | 'setIds'
    | 'busy'
    | 'currency'
    | 'scale'
    | 'holdWhere'
    | 'execute'
  >;
};

export function HoldsSection({ mode, sandbox }: Props) {
  const {
    holds,
    setHolds,
    holdCursor,
    setHoldCursor,
    holdState,
    setHoldState,
    ids,
    setIds,
    busy,
    currency,
    scale,
    holdWhere,
    execute,
  } = sandbox;
  return (
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
          {holdState ? 'No holds match this state.' : 'No holds yet. Reserve a payment to begin.'}
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
          <button className="secondary" onClick={() => setIds((old) => ({ ...old, hold: h.id }))}>
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
  );
}

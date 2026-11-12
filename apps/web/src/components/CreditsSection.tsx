import { query, type DemoMode } from '../api';
import type { Sandbox } from '../hooks/useSandbox';
import { ReadPanel } from './ReadPanel';

type Props = {
  mode: DemoMode;
  sandbox: Pick<Sandbox, 'ids' | 'setIds' | 'busy' | 'execute' | 'baseCreditAccount'>;
};

export function CreditsSection({ mode, sandbox }: Props) {
  const { ids, setIds, busy, execute, baseCreditAccount } = sandbox;
  return (
    <>
      <section className="panel">
        <p className="eyebrow">PREPAID CAPACITY</p>
        <h2>From issuance to consumption.</h2>
        <p>
          Issue multiple grants, spend from the promotional account, then inspect which lots funded
          each entry. Holds reserve capacity; refunds and expiration operate on the remaining
          eligible capacity.
        </p>
        <label>
          Selected grant ID
          <input
            aria-label="Selected grant ID"
            value={ids.grant}
            placeholder="Issue a grant or paste an ID from the directory"
            onChange={(e) => setIds((old) => ({ ...old, grant: e.target.value }))}
          />
        </label>
        <p className="muted">
          A full reversal requires an untouched grant. Refunds cannot return consumed, expired or
          actively reserved capacity.
        </p>
      </section>
      <div className="read-grid">
        <ReadPanel
          mode={mode}
          key={`${mode}:Credit balance`}
          title="Credit balance"
          path={`/v1/accounts/${baseCreditAccount}/credit-balance`}
          execute={execute}
          busy={busy}
        />
        <ReadPanel
          mode={mode}
          key={`${mode}:Credit lots`}
          title="Credit lots"
          path={`/v1/accounts/${baseCreditAccount}/credit-lots?limit=25`}
          execute={execute}
          busy={busy}
        />
      </div>
      <ReadPanel
        mode={mode}
        key={`${mode}:Grant directory`}
        title="Grant directory"
        path={query('/v1/credit-grants', { account_id: baseCreditAccount, limit: 25 })}
        execute={execute}
        busy={busy}
      />
    </>
  );
}

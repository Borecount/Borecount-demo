import { money, query, type DemoMode } from '../api';
import type { Sandbox } from '../hooks/useSandbox';
import { ReadPanel } from './ReadPanel';

type Props = {
  mode: DemoMode;
  sandbox: Pick<
    Sandbox,
    | 'ledger'
    | 'accounts'
    | 'selectedAccount'
    | 'setSelectedAccount'
    | 'balance'
    | 'busy'
    | 'currency'
    | 'scale'
    | 'execute'
    | 'availableAccount'
  >;
};

export function AccountsSection({ mode, sandbox }: Props) {
  const {
    ledger,
    accounts,
    selectedAccount,
    setSelectedAccount,
    balance,
    busy,
    currency,
    scale,
    execute,
    availableAccount,
  } = sandbox;
  return (
    <>
      <section className="panel">
        <div className="panel-title">
          <h2>Chart of accounts</h2>
          <span>{accounts.length} accounts · all cursor pages loaded</span>
        </div>
        <div className="account-grid">
          {accounts.map((a) => (
            <button
              className={`account-card ${selectedAccount === a.id ? 'selected' : ''}`}
              key={a.id}
              data-testid={`account-${a.name}`}
              onClick={() => setSelectedAccount(a.id)}
            >
              <div>
                <span className="badge">{a.side}</span>
                {a.grant_enabled && <span className="badge credit">GRANT</span>}
              </div>
              <h3>{a.name}</h3>
              <b>
                {money(
                  (a.side === 'CREDIT'
                    ? -BigInt(a.balance_minor)
                    : BigInt(a.balance_minor)
                  ).toString(),
                  a.currency,
                  scale,
                )}
              </b>
              <small>{a.overdraft_policy} overdraft</small>
              <code>{a.id}</code>
            </button>
          ))}
        </div>
      </section>
      {balance && (
        <section className="balance-strip">
          <div>
            <span>Selected</span>
            <strong>{availableAccount?.name}</strong>
          </div>
          <div>
            <span>Posted · canonical sign</span>
            <strong>{money(balance.posted_minor, currency, scale)}</strong>
          </div>
          <div>
            <span>Reserved delta</span>
            <strong>{money(balance.reserved_delta_minor, currency, scale)}</strong>
          </div>
          <div>
            <span>Available</span>
            <strong data-testid="available-balance">
              {money(balance.available_minor, currency, scale)}
            </strong>
          </div>
        </section>
      )}
      <ReadPanel
        mode={mode}
        key={`${mode}:Account directory`}
        title="Account directory"
        path={query('/v1/accounts', { ledger_id: ledger, limit: 25 })}
        execute={execute}
        busy={busy}
      />
    </>
  );
}

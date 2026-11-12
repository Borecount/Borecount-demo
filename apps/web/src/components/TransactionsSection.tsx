import { money, type DemoMode } from '../api';
import type { Sandbox } from '../hooks/useSandbox';
import { entriesAreBalanced, toEntryDisplay } from '../ledger-display';
import { newReference } from '../workspace-utils';
import { JsonBlock } from './DataView';

type Props = {
  mode: DemoMode;
  sandbox: Pick<
    Sandbox,
    | 'session'
    | 'accounts'
    | 'transactions'
    | 'txCursor'
    | 'txFilter'
    | 'setTxFilter'
    | 'ids'
    | 'selectedTx'
    | 'txEntries'
    | 'busy'
    | 'from'
    | 'setFrom'
    | 'to'
    | 'setTo'
    | 'amount'
    | 'setAmount'
    | 'reference'
    | 'setReference'
    | 'currency'
    | 'scale'
    | 'inspectTransaction'
    | 'sendTransfer'
    | 'moreTransactions'
    | 'walletAccounts'
  >;
};

export function TransactionsSection({ mode, sandbox }: Props) {
  const {
    session,
    accounts,
    transactions,
    txCursor,
    txFilter,
    setTxFilter,
    ids,
    selectedTx,
    txEntries,
    busy,
    from,
    setFrom,
    to,
    setTo,
    amount,
    setAmount,
    reference,
    setReference,
    currency,
    scale,
    inspectTransaction,
    sendTransfer,
    moreTransactions,
    walletAccounts,
  } = sandbox;
  return (
    <>
      <section className="grid">
        <form
          className="panel transfer"
          onSubmit={(e) => {
            e.preventDefault();
            void sendTransfer();
          }}
        >
          <div className="panel-title">
            <h2>New transfer</h2>
            <span>{currency} · double-entry</span>
          </div>
          <label>
            From
            <select value={from} onChange={(e) => setFrom(e.target.value)}>
              {walletAccounts.map((a) => (
                <option key={a.id}>{a.name}</option>
              ))}
            </select>
          </label>
          <label>
            To
            <select value={to} onChange={(e) => setTo(e.target.value)}>
              {walletAccounts.map((a) => (
                <option key={a.id}>{a.name}</option>
              ))}
            </select>
          </label>
          <label>
            Amount
            <input
              aria-label="Transfer amount"
              value={amount}
              inputMode="decimal"
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <label>
            Reference
            <input
              aria-label="Transfer reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </label>
          <div className="actions">
            <button className="primary" disabled={busy || !session}>
              Send transfer
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy || !session}
              onClick={() => void sendTransfer(true)}
            >
              Reserve transfer
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => setReference(newReference())}
            >
              New reference
            </button>
          </div>
        </form>
        <div className="panel">
          <p className="eyebrow">RETRIES YOU CAN SEE</p>
          <h2>One reference. One posting.</h2>
          <p>
            Send a transfer twice with the same reference and payload.{' '}
            {mode === 'rest'
              ? 'The first returns 201; the repeat returns 200 and created: false.'
              : 'The first returns created: true; the repeat returns the same transactionId and created: false.'}
          </p>
          <p>
            Change the amount while keeping the reference to inspect a payload mismatch. The
            original posting remains unchanged.
          </p>
          <p className="muted">Reversal and correction work on the transaction selected below.</p>
        </div>
      </section>
      <section className="panel ledger">
        <div className="panel-title">
          <h2>Transactions</h2>
          <span>10 per page · select to inspect</span>
        </div>
        <label>
          Exact reference filter
          <input
            placeholder="All references"
            value={txFilter}
            onChange={(e) => setTxFilter(e.target.value)}
          />
        </label>
        {transactions.map((t) => (
          <button
            className={`transaction-row ${ids.tx === t.id ? 'selected' : ''}`}
            key={t.id}
            onClick={() => void inspectTransaction(t)}
          >
            <div>
              <strong>{t.description ?? t.reference}</strong>
              <code>{t.reference}</code>
            </div>
            <span>{t.relation_type ?? 'POSTING'}</span>
            <time>{new Date(t.effective_at).toLocaleString()}</time>
            <span>↗</span>
          </button>
        ))}
        {!transactions.length && <p className="muted">No matching transactions.</p>}
        {txCursor && (
          <button className="secondary" disabled={busy} onClick={() => void moreTransactions()}>
            Load more transactions
          </button>
        )}
      </section>
      {selectedTx && (
        <section className="panel ledger">
          <div className="panel-title">
            <h2>How Borecount recorded it</h2>
            <span>{selectedTx.reference}</span>
          </div>
          <p>
            <code>{selectedTx.id}</code>
          </p>
          <p>
            Effective: {selectedTx.effective_at} · Created: {selectedTx.created_at}
          </p>
          {selectedTx.related_transaction_id && (
            <p>
              {selectedTx.relation_type} → <code>{selectedTx.related_transaction_id}</code>
            </p>
          )}
          {txEntries.map((e) => {
            const d = toEntryDisplay(e.signed_amount_minor);
            return (
              <div className="entry" key={e.id}>
                <span className={`badge ${d?.direction.toLowerCase()}`}>{d?.direction}</span>
                <strong>{accounts.find((a) => a.id === e.account_id)?.name ?? e.account_id}</strong>
                <span>{money(d?.magnitudeMinor ?? '0', e.currency, scale)}</span>
              </div>
            );
          })}
          <p className="balanced">
            {entriesAreBalanced(txEntries) ? '✓ Debits and credits balance' : 'Loading entries…'}
          </p>
          <details>
            <summary>Metadata</summary>
            <JsonBlock value={selectedTx.metadata} />
          </details>
        </section>
      )}
    </>
  );
}

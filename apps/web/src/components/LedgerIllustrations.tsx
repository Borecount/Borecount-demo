// Presentation-only examples. No sandbox reads or writes are needed to render them.
export function LedgerExample() {
  return (
    <figure className="ledger-example" aria-labelledby="ledger-example-title">
      <figcaption>
        <span className="example-label">ILLUSTRATIVE POSTING · USD</span>
        <h2 id="ledger-example-title">One transfer. Both sides accounted for.</h2>
        <p>Alice pays Bob $25.00 from her wallet.</p>
      </figcaption>
      <table>
        <caption className="sr-only">Balanced wallet transfer in USD, shown in major units</caption>
        <thead><tr><th scope="col">Wallet</th><th scope="col">Debit</th><th scope="col">Credit</th></tr></thead>
        <tbody>
          <tr><th scope="row">Alice <small>Customer liability</small></th><td>25.00</td><td>—</td></tr>
          <tr><th scope="row">Bob <small>Customer liability</small></th><td>—</td><td>25.00</td></tr>
        </tbody>
        <tfoot><tr><th scope="row"><span className="balanced-label">✓ Balanced</span></th><td>25.00</td><td>25.00</td></tr></tfoot>
      </table>
      <div className="example-balances">
        <span className="example-label">DISPLAYED WALLET BALANCES</span>
        <div><span>Alice</span><span>100.00 <span aria-hidden="true">→</span><span className="sr-only"> to </span> <strong>75.00</strong></span></div>
        <div><span>Bob</span><span>0.00 <span aria-hidden="true">→</span><span className="sr-only"> to </span> <strong>25.00</strong></span></div>
      </div>
      <p className="example-note">Credit-normal wallets: a debit lowers the balance; a credit raises it. API amounts use minor units.</p>
    </figure>
  );
}

// The card title and description provide the accessible explanation of each illustration.
export function ScenarioPreview({ scenario }: { scenario: string }) {
  return (
    <span className="scenario-preview" aria-hidden="true">
      {scenario === 'Wallet' && <>
        <span className="preview-wallets"><span>Alice<b>75.00</b></span><i>→</i><span>Bob<b>25.00</b></span></span>
        <span className="preview-foot">25.00 transferred</span>
      </>}
      {scenario === 'Marketplace' && <>
        <span className="preview-total">Order <b>25.00</b></span>
        <span className="preview-bar"><span /><span /></span>
        <span className="preview-split"><span>Seller <b>23.00</b></span><span>Fee <b>2.00</b></span></span>
      </>}
      {scenario === 'Authorization & capture' && <>
        <span className="preview-total">Reserve <b>25.00</b></span>
        <span className="preview-branch">↓</span>
        <span className="preview-split"><span>Capture<b>10.00</b></span><span>Release<b>15.00</b></span></span>
      </>}
      {scenario === 'Prepaid credits' && <>
        <span className="preview-total">Grant <b>50.00</b></span>
        <span className="preview-credit"><span>−12.00 used</span><b>38.00 left</b></span>
        <span className="preview-foot">Tracked to the grant</span>
      </>}
      {scenario === 'Finance' && <>
        <span className="preview-match"><span>Ledger</span><i>↔</i><span>Provider</span></span>
        <span className="preview-reconcile"><span>✓ Matched</span><span>≠ Investigate</span></span>
        <span className="preview-foot">Reconciliation report</span>
      </>}
    </span>
  );
}

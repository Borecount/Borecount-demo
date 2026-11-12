export const scenarios = [
  {
    name: 'Wallet',
    summary: 'Fund a wallet, pay another customer, retry safely and inspect insufficient funds.',
    steps: ['fund', 'transfer', 'overdraft'],
  },
  {
    name: 'Marketplace',
    summary: 'Split an order between a seller and platform fees, then correct or reverse it.',
    steps: ['marketplace', 'reverse', 'transfer', 'correct'],
  },
  {
    name: 'Authorization & capture',
    summary: 'Reserve 25.00, capture 10.00 and release the remaining 15.00.',
    steps: ['hold', 'commit', 'void'],
  },
  // Release the reservation before refunding: actively reserved credit capacity cannot be refunded.
  {
    name: 'Prepaid credits',
    summary:
      'Issue expiring credit grants, reserve and consume capacity, then refund and expire eligible value.',
    steps: [
      'grant',
      'grant-expiring',
      'credit-hold',
      'consume',
      'void',
      'refund',
      'expiration-preview',
      'expiration-run',
      'allocations',
    ],
  },
  {
    name: 'Finance',
    summary: 'Build matching criteria, import a provider statement and investigate differences.',
    steps: [
      'rule',
      'upload',
      'reconcile-preview',
      'reconcile',
      'recon-results',
      'adjust-credit',
      'reconcile',
    ],
  },
];

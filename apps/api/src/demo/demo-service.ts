import { randomUUID } from 'node:crypto';
import { AccountSide, type ApplicationServices } from '@borecount/core/application';
import { OverdraftPolicy, type AccountEntity } from '@borecount/core/account';
import type { DbClient } from '@borecount/postgres-adapter';

const LEDGER_NAME = 'Borecount transfer demo';
const CURRENCY = 'USD';
const FUNDING_ADDRESS = 'system:funding';
const ADDRESS_PATTERN = /^[a-z][a-z0-9]*(?::[a-z][a-z0-9-]*)+$/;

export class DemoInputError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'DEMO_INPUT_ERROR';
  }
}

export class DemoNotReadyError extends Error {
  readonly statusCode = 409;
  constructor() {
    super('Demo data has not been seeded');
    this.name = 'DEMO_NOT_READY';
  }
}

export class DemoService {
  private resetPromise: ReturnType<DemoService['getState']> | null = null;

  constructor(
    private readonly db: DbClient,
    private readonly services: ApplicationServices,
    private readonly config: {
      adminApiKey: string;
      adminKeyName: string;
      tenantName: string;
      resetEnabled: boolean;
    },
  ) {}

  async getState() {
    const { tenantId, ledgerId } = await this.context();
    const accounts = await this.accounts(tenantId, ledgerId);
    const addresses = new Map(accounts.map((account) => [account.id, account.name]));
    const transactions = await this.services.transactions.list({ tenantId, ledgerId, limit: 100 });

    // The released service has no hold-list operation. This tenant/ledger-scoped
    // read is presentation only; all lifecycle mutations use the public hold service.
    // Active holds must remain actionable even after the completed history fills up.
    const holds = await this.db.sql`select id, reference, description, state,
      original_amount_minor::text as original_amount_minor,
      remaining_amount_minor::text as remaining_amount_minor
      from (
        select * from holds
        where tenant_id = ${tenantId} and ledger_id = ${ledgerId} and state = 'HELD'
        union all
        (select * from holds
        where tenant_id = ${tenantId} and ledger_id = ${ledgerId} and state <> 'HELD'
        order by created_at desc, id desc limit 100)
      ) as demo_holds
      order by created_at desc, id desc`;
    const trial = await this.services.balances.getTrialBalance({ tenantId, ledgerId });
    return {
      holds,
      trial_balance: { debits_minor: trial.totalDebitsMinor.toString(),
        credits_minor: trial.totalCreditsMinor.toString() },
      transactions_limited: transactions.nextCursor !== null,
      currency: CURRENCY,
      ledger_id: ledgerId,
      reset_enabled: this.config.resetEnabled,
      accounts: accounts
        .filter((account) => account.name !== FUNDING_ADDRESS)
        .map((account) => ({
          id: account.id,
          address: account.name,
          balance_minor: (
            account.side === AccountSide.CREDIT ? -account.balanceMinor : account.balanceMinor
          ).toString(),
          currency: account.currency,
        }))
        .sort((left, right) => left.address.localeCompare(right.address)),
      transactions: transactions.data.map((transaction) => ({
        id: transaction.id.toString(),
        reference: transaction.reference,
        description: transaction.description,
        created_at: transaction.createdAt?.toISOString() ?? null,
        entries: transaction.entries.map((entry) => ({
          account_address: addresses.get(String(entry.accountId)) ?? String(entry.accountId),
          signed_amount_minor: entry.money.amountMinor.toString(),
        })),
      })),
    };
  }

  async getAccountDetails(address: string) {
    const { tenantId, ledgerId } = await this.context();
    const account = await this.accountByAddress(tenantId, ledgerId, normalizeAddress(address));
    const at = new Date();
    const balance = await this.services.balances.getAt({ tenantId, accountId: account.id, at });
    const history = await this.services.balances.listHistory({
      tenantId, accountId: account.id, from: new Date(0), to: at, limit: 100,
    });
    return {
      address: account.name,
      currency: account.currency,
      available_minor: balance.availableMinor.toString(),
      history_limited: history.nextCursor !== null,
      history: history.data.map(event => ({
        id: event.id, event: event.eventType,
        posted_minor: event.postedMinor.toString(),
        reserved_minor: event.reservedDeltaMinor.toString(),
        created_at: event.createdAt.toISOString(),
      })),
    };
  }

  async createAccount(address: string) {
    const normalized = normalizeAddress(address);
    const { tenantId, ledgerId } = await this.context();
    if (await this.accountExists(tenantId, ledgerId, normalized)) {
      throw new DemoInputError(`Account ${normalized} already exists`);
    }
    await this.services.accounts.create({
      tenantId,
      ledgerId,
      name: normalized,
      side: AccountSide.CREDIT,
      overdraftPolicy: OverdraftPolicy.DISALLOW,
      currency: CURRENCY,
    });
    return this.getState();
  }

  async fund(address: string, amountMinor: string, reference = `demo-funding-${randomUUID()}`) {
    const amount = parseAmount(amountMinor);
    const { tenantId, ledgerId } = await this.context();
    const destination = await this.accountByAddress(tenantId, ledgerId, normalizeAddress(address));
    const funding = await this.accountByAddress(tenantId, ledgerId, FUNDING_ADDRESS);
    await this.services.transactions.create({
      tenantId,
      ledgerId,
      reference,
      currency: CURRENCY,
      description: `Fund ${destination.name}`,
      entries: [
        entry(funding.id, amount),
        entry(destination.id, -amount),
      ],
    });
    return this.getState();
  }

  async transfer(from: string, to: string, amountMinor: string) {
    const sourceAddress = normalizeAddress(from);
    const destinationAddress = normalizeAddress(to);
    if (sourceAddress === destinationAddress) {
      throw new DemoInputError('Source and destination accounts must be different');
    }
    const amount = parseAmount(amountMinor);
    const { tenantId, ledgerId } = await this.context();
    const source = await this.accountByAddress(tenantId, ledgerId, sourceAddress);
    const destination = await this.accountByAddress(tenantId, ledgerId, destinationAddress);
    await this.services.transactions.create({
      tenantId,
      ledgerId,
      reference: `demo-transfer-${randomUUID()}`,
      currency: CURRENCY,
      description: `${source.name} to ${destination.name}`,
      entries: [
        entry(source.id, amount),
        entry(destination.id, -amount),
      ],
    });
    return this.getState();
  }

  async createHold(from: string, to: string, amountMinor: string) {
    const { tenantId, ledgerId } = await this.context();
    const source = await this.accountByAddress(tenantId, ledgerId, normalizeAddress(from));
    const destination = await this.accountByAddress(tenantId, ledgerId, normalizeAddress(to));
    if (source.id === destination.id) throw new DemoInputError('Source and destination accounts must be different');
    const amount = parseAmount(amountMinor);
    await this.services.holds.create({ tenantId, ledgerId, reference: `demo-hold-${randomUUID()}`,
      currency: CURRENCY, description: `${source.name} to ${destination.name}`,
      entries: [entry(source.id, amount), entry(destination.id, -amount)] });
    return this.getState();
  }

  async resolveHold(holdId: string, action: 'commit' | 'void') {
    const { tenantId, ledgerId } = await this.context();
    const rows = await this.db.sql`select id from holds where id = ${holdId}
      and tenant_id = ${tenantId} and ledger_id = ${ledgerId}`;
    if (rows.length === 0) throw new DemoInputError('Unknown demo hold');
    if (action === 'commit') {
      await this.services.holds.commit({ tenantId, holdId, reference: `demo-commit-${holdId}` });
    } else {
      await this.services.holds.void({ tenantId, holdId });
    }
    return this.getState();
  }

  async reconcile(reference: string, amountMinor: string) {
    const { tenantId, ledgerId } = await this.context();
    const upload = await this.services.reconciliation.ingest({ tenantId, source: 'demo-statement',
      records: [{ externalId: randomUUID(), reference, amountMinor: parseAmount(amountMinor),
        currency: CURRENCY, occurredAt: new Date() }] });
    const rules = await this.services.reconciliation.listRules({
      tenantId, limit: 1, where: { name: { eq: 'Demo statement match' } },
    });
    let rule = rules.data[0];
    rule ??= await this.services.reconciliation.createRule({ tenantId, name: 'Demo statement match',
      criteria: [{ field: 'reference', operator: 'equals' }, { field: 'amount', operator: 'equals' },
        { field: 'currency', operator: 'equals' }] });
    return this.services.reconciliation.run({ tenantId, ledgerId, uploadId: upload.id,
      matchingRuleIds: [rule.id], strategy: 'one_to_one' });
  }

  async reset() {
    if (this.resetPromise !== null) return this.resetPromise;
    this.resetPromise = this.performReset();
    try {
      return await this.resetPromise;
    } finally {
      this.resetPromise = null;
    }
  }

  private async performReset() {
    if (this.config.adminApiKey.length === 0) {
      throw new Error('BOOTSTRAP_ADMIN_API_KEY is required for demo reset');
    }
    await this.db.sql.unsafe(`truncate table recon_results, recon_runs, recon_records,
      recon_uploads, recon_rules, balance_snapshots, hold_entries, holds, entries,
      transactions, accounts, ledgers, api_keys, tenants restart identity cascade`);
    return this.performSeed();
  }

  async seed() {
    try {
      return await this.getState();
    } catch (error) {
      if (!(error instanceof DemoNotReadyError)) {
        throw error;
      }
    }
    return this.performSeed();
  }

  private async performSeed() {
    const bootstrap = await this.services.apiKeys.bootstrapInitialAdmin({
      tenantName: this.config.tenantName,
      keyName: this.config.adminKeyName,
      rawApiKey: this.config.adminApiKey,
    });
    const tenantId = bootstrap.created
      ? bootstrap.tenantId
      : (await this.services.apiKeys.authenticate(this.config.adminApiKey)).tenantId;
    if (tenantId === undefined) {
      throw new Error('Unable to create the demo tenant');
    }
    const assets = await this.services.assets.list({
      tenantId, limit: 1, where: { code: { eq: CURRENCY } },
    });
    if (assets.data.length === 0) {
      await this.services.assets.create({ tenantId, code: CURRENCY, scale: 2 });
    }
    const ledgers = await this.services.ledgers.list({
      tenantId, limit: 1, where: { name: { eq: LEDGER_NAME } },
    });
    let ledger = ledgers.data[0];
    ledger ??= await this.services.ledgers.create({ tenantId, name: LEDGER_NAME });
    const existingAccounts = await this.accounts(tenantId, ledger.id);
    for (const account of [
      { name: FUNDING_ADDRESS, side: AccountSide.DEBIT, policy: OverdraftPolicy.ALLOW },
      { name: 'wallet:alice', side: AccountSide.CREDIT, policy: OverdraftPolicy.DISALLOW },
      { name: 'wallet:bob', side: AccountSide.CREDIT, policy: OverdraftPolicy.DISALLOW },
    ]) {
      if (existingAccounts.some((candidate) => candidate.name === account.name)) {
        continue;
      }
      await this.services.accounts.create({
        tenantId,
        ledgerId: ledger.id,
        name: account.name,
        side: account.side,
        overdraftPolicy: account.policy,
        currency: CURRENCY,
      });
    }
    const transactions = await this.services.transactions.list({
      tenantId,
      ledgerId: ledger.id,
      limit: 100,
    });
    if (!transactions.data.some((transaction) => transaction.reference === 'demo-seed-funding-alice-v1')) {
      await this.fund('wallet:alice', '10000', 'demo-seed-funding-alice-v1');
    }
    return this.getState();
  }

  private async context(): Promise<{ tenantId: string; ledgerId: string }> {
    let tenantId: string;
    try {
      tenantId = (await this.services.apiKeys.authenticate(this.config.adminApiKey)).tenantId;
    } catch {
      throw new DemoNotReadyError();
    }
    const ledgers = await this.services.ledgers.list({
      tenantId, limit: 1, where: { name: { eq: LEDGER_NAME } },
    });
    const ledger = ledgers.data[0];
    if (ledger === undefined) throw new DemoNotReadyError();
    return { tenantId, ledgerId: ledger.id };
  }

  private async accounts(tenantId: string, ledgerId: string): Promise<AccountEntity[]> {
    const accounts: AccountEntity[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.services.accounts.list({ tenantId, ledgerId, limit: 100, cursor });
      accounts.push(...page.data);
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
    return accounts;
  }

  private async accountByAddress(tenantId: string, ledgerId: string, name: string): Promise<AccountEntity> {
    const page = await this.services.accounts.list({
      tenantId, ledgerId, limit: 1, where: { name: { eq: name } },
    });
    const account = page.data[0];
    if (account === undefined) {
      throw new DemoInputError(`Unknown account ${name}`);
    }
    return account;
  }

  private async accountExists(tenantId: string, ledgerId: string, name: string): Promise<boolean> {
    const page = await this.services.accounts.list({
      tenantId, ledgerId, limit: 1, where: { name: { eq: name } },
    });
    return page.data.length > 0;
  }
}

const normalizeAddress = (value: string): string => {
  const address = value.trim().toLowerCase();
  if (!ADDRESS_PATTERN.test(address) || address.length > 80) {
    throw new DemoInputError('Address must look like wallet:alice');
  }
  if (address === FUNDING_ADDRESS) throw new DemoInputError('The system funding account is reserved');
  return address;
};

const parseAmount = (value: string): bigint => {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new DemoInputError('amount_minor must be a positive base-10 integer string');
  }
  return BigInt(value);
};

const entry = (accountId: string, signedAmountMinor: bigint) => ({
  accountId,
  signedAmountMinor,
  currency: CURRENCY,
});

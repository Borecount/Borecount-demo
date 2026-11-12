import type { LedgerEntity } from '@borecount/core/ledger';
import type { ApplicationServices, PaginatedResult } from '@borecount/core/application';
import * as http from '@borecount/http';
import * as mappers from '@borecount/http/mappers';
import { libraryOperations } from '../../../../shared/library';
import type { LibraryServiceOperation } from './library-types';

/**
 * Preserve the input/result relationship at each explicit service binding. JSON
 * validation and typed conversion happen before this single tuple boundary.
 */
function operation<Arguments extends unknown[], Result>(
  invoke: (...args: Arguments) => Promise<Result>,
  mapResult: (result: Result) => unknown,
  filterFields?: http.FilterFields,
): LibraryServiceOperation {
  return {
    filterFields,
    async execute(args) {
      const value = await invoke(...(args as Arguments));
      return { value, result: mapResult(value) };
    },
  };
}

function pageOf<Item>(mapItem: (item: Item) => unknown) {
  return (page: PaginatedResult<Item>) => ({
    data: page.data.map(mapItem),
    next_cursor: page.nextCursor,
  });
}

// Ledger transport fields already use camelCase. Pick them explicitly so a new
// domain property cannot silently expand the panel's display contract.
function ledgerResult(ledger: LedgerEntity) {
  return {
    id: ledger.id,
    tenantId: ledger.tenantId,
    name: ledger.name,
    createdAt: ledger.createdAt,
    updatedAt: ledger.updatedAt,
  };
}

/** Every allowed operation owns its invocation, display mapping, and filter policy. */
export function createLibraryRegistry(
  services: ApplicationServices,
): Record<string, LibraryServiceOperation> {
  const definitions: Record<string, LibraryServiceOperation> = {
    'ledgers.list': operation(
      (...args: Parameters<ApplicationServices['ledgers']['list']>) =>
        services.ledgers.list(...args),
      pageOf(ledgerResult),
      http.ledgerFilterFields,
    ),
    'ledgers.getById': operation(
      (...args: Parameters<ApplicationServices['ledgers']['getById']>) =>
        services.ledgers.getById(...args),
      ledgerResult,
    ),
    'ledgers.create': operation(
      (...args: Parameters<ApplicationServices['ledgers']['create']>) =>
        services.ledgers.create(...args),
      ledgerResult,
    ),
    'accounts.list': operation(
      (...args: Parameters<ApplicationServices['accounts']['list']>) =>
        services.accounts.list(...args),
      pageOf(mappers.toAccountResponse),
      http.accountFilterFields,
    ),
    'accounts.getById': operation(
      (...args: Parameters<ApplicationServices['accounts']['getById']>) =>
        services.accounts.getById(...args),
      mappers.toAccountResponse,
    ),
    'accounts.create': operation(
      (...args: Parameters<ApplicationServices['accounts']['create']>) =>
        services.accounts.create(...args),
      mappers.toAccountResponse,
    ),
    'transactions.list': operation(
      (...args: Parameters<ApplicationServices['transactions']['list']>) =>
        services.transactions.list(...args),
      pageOf(mappers.toTransactionResponse),
      http.transactionFilterFields,
    ),
    'transactions.getById': operation(
      (...args: Parameters<ApplicationServices['transactions']['getById']>) =>
        services.transactions.getById(...args),
      mappers.toTransactionResponse,
    ),
    'transactions.create': operation(
      (...args: Parameters<ApplicationServices['transactions']['create']>) =>
        services.transactions.create(...args),
      mappers.toCreateTransactionResponse,
    ),
    'holds.list': operation(
      (...args: Parameters<ApplicationServices['holds']['list']>) => services.holds.list(...args),
      pageOf(mappers.toHoldSummaryResponse),
      http.holdSummaryFilterFields,
    ),
    'holds.getById': operation(
      (...args: Parameters<ApplicationServices['holds']['getById']>) =>
        services.holds.getById(...args),
      mappers.toHoldSummaryResponse,
    ),
    'holds.create': operation(
      (...args: Parameters<ApplicationServices['holds']['create']>) =>
        services.holds.create(...args),
      (result) => ({
        hold_id: result.holdId,
        created: result.created,
        state: result.state,
        remaining_amount_minor: result.remainingAmountMinor,
      }),
    ),
    'creditGrants.list': operation(
      (...args: Parameters<ApplicationServices['creditGrants']['list']>) =>
        services.creditGrants.list(...args),
      pageOf(mappers.toCreditGrantResponse),
      http.creditGrantFilterFields,
    ),
    'creditGrants.getById': operation(
      (...args: Parameters<ApplicationServices['creditGrants']['getById']>) =>
        services.creditGrants.getById(...args),
      mappers.toCreditGrantResponse,
    ),
    'creditGrants.create': operation(
      (...args: Parameters<ApplicationServices['creditGrants']['create']>) =>
        services.creditGrants.create(...args),
      (result) => mappers.toCreditGrantResponse(result.grant),
    ),
    'transactions.reverse': operation(
      (...args: Parameters<ApplicationServices['transactions']['reverse']>) =>
        services.transactions.reverse(...args),
      mappers.toCreateTransactionResponse,
    ),
    'transactions.correct': operation(
      (...args: Parameters<ApplicationServices['transactions']['correct']>) =>
        services.transactions.correct(...args),
      (result) => ({
        reversal_transaction_id: result.reversalTransactionId,
        corrected_transaction_id: result.correctedTransactionId,
        created: result.created,
      }),
    ),
    'holds.commit': operation(
      (...args: Parameters<ApplicationServices['holds']['commit']>) =>
        services.holds.commit(...args),
      (result) => ({
        hold_id: result.holdId,
        transaction_id: result.transactionId,
        created: result.created,
        state: result.state,
        remaining_amount_minor: result.remainingAmountMinor,
      }),
    ),
    'holds.void': operation(
      (...args: Parameters<ApplicationServices['holds']['void']>) => services.holds.void(...args),
      (result) => ({
        hold_id: result.holdId,
        state: result.state,
        remaining_amount_minor: result.remainingAmountMinor,
        voided: result.voided,
      }),
    ),
    'creditGrants.reverse': operation(
      (...args: Parameters<ApplicationServices['creditGrants']['reverse']>) =>
        services.creditGrants.reverse(...args),
      (result) => mappers.toCreditGrantResponse(result.grant),
    ),
    'creditGrants.refund': operation(
      (...args: Parameters<ApplicationServices['creditGrants']['refund']>) =>
        services.creditGrants.refund(...args),
      mappers.toRefundCreditGrantResponse,
    ),
    'transactions.createBulk': operation(
      (...args: Parameters<ApplicationServices['transactions']['createBulk']>) =>
        services.transactions.createBulk(...args),
      (result) => ({
        created_count: result.createdCount,
        idempotent_count: result.idempotentCount,
        transactions: result.transactions.map((transaction) => ({
          reference: transaction.reference,
          transaction_id: transaction.transactionId,
          created: transaction.created,
        })),
      }),
    ),
    'transactions.listEntries': operation(
      (...args: Parameters<ApplicationServices['transactions']['listEntries']>) =>
        services.transactions.listEntries(...args),
      pageOf(mappers.toEntryResponse),
      http.entryFilterFields,
    ),
    'balances.getAt': operation(
      (...args: Parameters<ApplicationServices['balances']['getAt']>) =>
        services.balances.getAt(...args),
      (balance) => ({
        account_id: balance.accountId,
        timestamp: balance.at,
        posted_minor: balance.postedMinor,
        reserved_delta_minor: balance.reservedDeltaMinor,
        available_minor: balance.availableMinor,
      }),
    ),
    'balances.listHistory': operation(
      (...args: Parameters<ApplicationServices['balances']['listHistory']>) =>
        services.balances.listHistory(...args),
      (page) => ({
        data: page.data.map((snapshot) => ({
          id: snapshot.id,
          tenant_id: snapshot.tenantId,
          ledger_id: snapshot.ledgerId,
          account_id: snapshot.accountId,
          event_type: snapshot.eventType,
          source_id: snapshot.sourceId,
          posted_minor: snapshot.postedMinor,
          reserved_delta_minor: snapshot.reservedDeltaMinor,
          effective_at: snapshot.effectiveAt,
          created_at: snapshot.createdAt,
        })),
        next_cursor: page.nextCursor,
      }),
      http.balanceHistoryFilterFields,
    ),
    'balances.getTrialBalance': operation(
      (...args: Parameters<ApplicationServices['balances']['getTrialBalance']>) =>
        services.balances.getTrialBalance(...args),
      mappers.toTrialBalanceResponse,
    ),
    'statements.getAccountStatement': operation(
      (...args: Parameters<ApplicationServices['statements']['getAccountStatement']>) =>
        services.statements.getAccountStatement(...args),
      mappers.toAccountStatementResponse,
    ),
    'statements.getCreditLotStatement': operation(
      (...args: Parameters<ApplicationServices['statements']['getCreditLotStatement']>) =>
        services.statements.getCreditLotStatement(...args),
      mappers.toCreditLotStatementResponse,
    ),
    'creditGrants.getBalance': operation(
      (...args: Parameters<ApplicationServices['creditGrants']['getBalance']>) =>
        services.creditGrants.getBalance(...args),
      mappers.toCreditBalanceResponse,
    ),
    'creditGrants.listLots': operation(
      (...args: Parameters<ApplicationServices['creditGrants']['listLots']>) =>
        services.creditGrants.listLots(...args),
      pageOf(mappers.toCreditGrantLotResponse),
      http.creditGrantFilterFields,
    ),
    'creditGrants.listLineageByGrant': operation(
      (...args: Parameters<ApplicationServices['creditGrants']['listLineageByGrant']>) =>
        services.creditGrants.listLineageByGrant(...args),
      pageOf(mappers.toCreditGrantLineageItemResponse),
      http.creditLineageFilterFields,
    ),
    'creditGrants.listLineageByTransaction': operation(
      (...args: Parameters<ApplicationServices['creditGrants']['listLineageByTransaction']>) =>
        services.creditGrants.listLineageByTransaction(...args),
      pageOf(mappers.toCreditGrantLineageItemResponse),
      http.creditLineageFilterFields,
    ),
    'holds.listEntries': operation(
      (...args: Parameters<ApplicationServices['holds']['listEntries']>) =>
        services.holds.listEntries(...args),
      pageOf(mappers.toHoldEntryResponse),
      http.holdEntryFilterFields,
    ),
    'holds.listCaptures': operation(
      (...args: Parameters<ApplicationServices['holds']['listCaptures']>) =>
        services.holds.listCaptures(...args),
      pageOf(mappers.toHoldCaptureResponse),
      http.holdCaptureFilterFields,
    ),
    'holds.listCreditAllocations': operation(
      (...args: Parameters<ApplicationServices['holds']['listCreditAllocations']>) =>
        services.holds.listCreditAllocations(...args),
      pageOf(mappers.toHoldCreditAllocationResponse),
      http.holdCreditAllocationFilterFields,
    ),
    'creditGrants.previewExpirations': operation(
      (...args: Parameters<ApplicationServices['creditGrants']['previewExpirations']>) =>
        services.creditGrants.previewExpirations(...args),
      mappers.toCreditGrantExpirationResponse,
    ),
    'creditGrants.runExpirations': operation(
      (...args: Parameters<ApplicationServices['creditGrants']['runExpirations']>) =>
        services.creditGrants.runExpirations(...args),
      mappers.toCreditGrantExpirationResponse,
    ),
    'adjustments.credit': operation(
      (...args: Parameters<ApplicationServices['adjustments']['credit']>) =>
        services.adjustments.credit(...args),
      mappers.toAdjustmentResponse,
    ),
    'adjustments.debit': operation(
      (...args: Parameters<ApplicationServices['adjustments']['debit']>) =>
        services.adjustments.debit(...args),
      mappers.toAdjustmentResponse,
    ),
    'reconciliation.createRule': operation(
      (...args: Parameters<ApplicationServices['reconciliation']['createRule']>) =>
        services.reconciliation.createRule(...args),
      mappers.toReconRuleResponse,
    ),
    'reconciliation.ingest': operation(
      (...args: Parameters<ApplicationServices['reconciliation']['ingest']>) =>
        services.reconciliation.ingest(...args),
      mappers.toReconUploadResponse,
    ),
    'reconciliation.run': operation(
      (...args: Parameters<ApplicationServices['reconciliation']['run']>) =>
        services.reconciliation.run(...args),
      mappers.toReconRunResponse,
    ),
    'reconciliation.listRules': operation(
      (...args: Parameters<ApplicationServices['reconciliation']['listRules']>) =>
        services.reconciliation.listRules(...args),
      pageOf(mappers.toReconRuleResponse),
      http.reconRuleFilterFields,
    ),
    'reconciliation.listUploads': operation(
      (...args: Parameters<ApplicationServices['reconciliation']['listUploads']>) =>
        services.reconciliation.listUploads(...args),
      pageOf(mappers.toReconUploadResponse),
      http.reconUploadListFilterFields,
    ),
    'reconciliation.getUpload': operation(
      (...args: Parameters<ApplicationServices['reconciliation']['getUpload']>) =>
        services.reconciliation.getUpload(...args),
      mappers.toReconUploadResponse,
    ),
    // The canonical records endpoint supports limit/cursor, without where filters.
    'reconciliation.listRecords': operation(
      (...args: Parameters<ApplicationServices['reconciliation']['listRecords']>) =>
        services.reconciliation.listRecords(...args),
      pageOf(mappers.toReconRecordResponse),
    ),
    'reconciliation.listRuns': operation(
      (...args: Parameters<ApplicationServices['reconciliation']['listRuns']>) =>
        services.reconciliation.listRuns(...args),
      pageOf(mappers.toReconRunSummaryResponse),
      http.reconRunListFilterFields,
    ),
    'reconciliation.getRun': operation(
      (...args: Parameters<ApplicationServices['reconciliation']['getRun']>) =>
        services.reconciliation.getRun(...args),
      mappers.toReconRunResponse,
    ),
    'reconciliation.listResults': operation(
      (...args: Parameters<ApplicationServices['reconciliation']['listResults']>) =>
        services.reconciliation.listResults(...args),
      pageOf(mappers.toReconResultResponse),
      http.reconResultListFilterFields,
    ),
  };

  // Fail before serving traffic if either browser metadata or server coverage drifts.
  const allowed = new Set(libraryOperations.map((entry) => entry.operation));
  for (const name of allowed) {
    if (!Object.hasOwn(definitions, name))
      throw new Error(`Missing library implementation: ${name}`);
  }
  for (const name of Object.keys(definitions)) {
    if (!allowed.has(name)) throw new Error(`Unexpected library implementation: ${name}`);
  }
  return definitions;
}

import type * as Contract from './generated-contract';
import { toLibraryCall } from '../../../shared/library';
import type { LibraryCall, LibraryExecutionResponse } from '../../../shared/library-types';

export {
  libraryCode,
  toLibraryCall,
  toRestRequest,
  type LibraryCall,
} from '../../../shared/library';

export type DemoMode = 'rest' | 'library';
export type Json = Contract.Json;

export interface DemoRequest {
  method: 'GET' | 'POST';
  path: string;
  body?: Record<string, Json>;
  libraryCall?: LibraryCall;
}

export interface RequestRecord {
  id: number;
  request: DemoRequest;
  status: number;
  response: Json;
  duration: number;
  requestId: string | null;
  foreground?: boolean;
  mode?: DemoMode | 'host';
  call?: LibraryCall;
}

export interface Page<T> {
  data: T[];
  next_cursor: string | null;
}

export type Ledger = Contract.Ledger;
export type Account = Contract.Account;
export type Entry = Contract.EntriesPage['data'][number];
export type Transaction = Contract.Transaction;
export type Hold = Contract.HoldSummary;

export interface Session {
  access_token: string;
  expires_in: number;
  tenant_id: string;
  actor_id: string;
  session_expires_at: string;
  assets: { code: string; scale: number }[];
}

export type Balance = Contract.BalanceAsOfResponse;

export class DemoApiError extends Error {
  constructor(
    public status: number,
    public payload: Json,
  ) {
    super(
      typeof payload === 'object' && payload !== null && !Array.isArray(payload)
        ? `${payload.error ?? 'ERROR'}: ${payload.message ?? 'Request failed'}`
        : 'Request failed',
    );
  }
}

let token = '';
let mode: DemoMode = 'rest';
const pending = new Set<AbortController>();

export function setDemoMode(next: DemoMode) {
  mode = next;

  // Cancel pending browser requests when the selected execution path changes.
  // An aborted fetch cannot undo a database operation already running on the
  // server, so the workspace disables switching while a write is in progress.
  // Host session requests stay live because both modes share the same session.
  for (const controller of pending) controller.abort();
  pending.clear();
}

let observer: (record: RequestRecord) => void = () => {};
let recordId = 0;

// Session payloads and key-management responses can be observed alongside
// normal calls, so remove credential fields before storing any result.
export function redact(value: Json): Json {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      /^(access_token|api_key|authorization|x-api-key|token_hash)$/i.test(key)
        ? '[redacted]'
        : redact(child),
    ]),
  );
}

export function recordExternal(record: Omit<RequestRecord, 'id'>) {
  observer({ ...record, id: ++recordId, response: redact(record.response) });
}

export const observeRequests = (next: typeof observer) => {
  observer = next;
  return () => {
    observer = () => {};
  };
};

export const setAccessToken = (value: string) => {
  // Keep the sandbox bearer in memory; never put it in the journal or storage.
  token = value;
};

export async function request<T = Record<string, Json>>(
  operation: DemoRequest,
  signal?: AbortSignal,
  foreground = false,
): Promise<T> {
  // The sandbox credential must only go to the local REST API. Library calls
  // are translated to a fixed same-origin bridge route below.
  if (
    !/^\/(?:v1\/|demo\/session(?:[/?]|$))/.test(operation.path) ||
    operation.path.includes('\\') ||
    operation.path.includes('#')
  ) {
    throw new Error('Use a local /v1/ or sandbox path');
  }

  const url = new URL(operation.path, window.location.origin);
  if (
    url.origin !== window.location.origin ||
    !/^\/(?:v1\/|demo\/session(?:[/?]|$))/.test(url.pathname)
  ) {
    throw new Error('Use a local API endpoint');
  }

  // Session calls belong to the host and stay the same when the user switches
  // modes. Only /v1 business operations follow the selected execution mode.
  const executionMode = operation.path.startsWith('/v1/') ? mode : 'host';
  const requestedCall =
    executionMode === 'library' ? (operation.libraryCall ?? toLibraryCall(operation)) : undefined;

  const modeController = new AbortController();
  if (executionMode !== 'host') pending.add(modeController);
  const requestSignal = signal
    ? AbortSignal.any([signal, modeController.signal])
    : modeController.signal;

  const startedAt = performance.now();
  let status = 0;
  let responseBody: Json = null;
  let nativeValue: Json | undefined;
  // A successful bridge response can return its canonical method call. Keep it
  // separate from requestedCall: journal replay uses the user's original call.
  let actualCall = requestedCall;
  let requestId: string | null = null;

  try {
    const bridgeCall = requestedCall !== undefined;
    const response = await fetch(bridgeCall ? '/demo/library/execute' : url.pathname + url.search, {
      method: bridgeCall ? 'POST' : operation.method,
      signal: requestSignal,
      credentials: 'same-origin',
      headers: {
        ...(executionMode === 'rest' && token ? { authorization: `Bearer ${token}` } : {}),
        ...(bridgeCall || operation.body !== undefined
          ? { 'content-type': 'application/json' }
          : {}),
      },
      body: bridgeCall
        ? JSON.stringify(requestedCall)
        : operation.body === undefined
          ? undefined
          : JSON.stringify(operation.body),
    });

    status = response.status;
    requestId = response.headers.get('x-request-id');
    const rawResponse = await response.text();
    try {
      responseBody = rawResponse ? JSON.parse(rawResponse) : null;
    } catch {
      responseBody = rawResponse;
    }

    if (!response.ok) throw new DemoApiError(status, responseBody);

    if (bridgeCall) {
      const envelope = responseBody as unknown as LibraryExecutionResponse<Json>;

      // UI consumers receive the display-safe result. The journal keeps the
      // native value so method output and the converted result remain distinct.
      nativeValue = envelope.value;
      actualCall = envelope.call;
      return envelope.result as T;
    }

    return responseBody as T;
  } finally {
    pending.delete(modeController);

    // Mode changes abort business calls; omitting those records avoids logging
    // a cancelled request as a failed REST or Library operation.
    if (!requestSignal.aborted) {
      observer({
        id: ++recordId,
        request: structuredClone({
          ...operation,
          ...(requestedCall ? { libraryCall: requestedCall } : {}),
        }),
        mode: executionMode,
        call: actualCall,
        status,
        response: redact(requestedCall && nativeValue !== undefined ? nativeValue : responseBody),
        requestId,
        foreground,
        duration: Math.round(performance.now() - startedAt),
      });
    }
  }
}

export const query = (path: string, values: Record<string, string | number | undefined>) => {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });

  return path + (params.size ? `?${params}` : '');
};

export async function allPages<T>(path: string, signal?: AbortSignal): Promise<T[]> {
  const url = new URL(path, window.location.origin);
  const data: T[] = [];
  let cursor: string | null = null;

  do {
    if (cursor) url.searchParams.set('cursor', cursor);
    const page: Page<T> = await request({ method: 'GET', path: url.pathname + url.search }, signal);
    data.push(...page.data);
    cursor = page.next_cursor;
  } while (cursor);

  return data;
}

const shellSingleQuote = (value: string) => `'${value.replaceAll("'", "'\"'\"'")}'`;

export const requestToCurl = (operation: DemoRequest, origin: string): string => {
  const lines = [`curl -X ${operation.method} ${shellSingleQuote(`${origin}${operation.path}`)}`];
  if (operation.path.startsWith('/v1/')) {
    lines.push('  -H "Authorization: Bearer $ACCESS_TOKEN"');
  }
  if (operation.body !== undefined) {
    lines.push("  -H 'content-type: application/json'");
    lines.push(`  --data ${shellSingleQuote(JSON.stringify(operation.body))}`);
  }

  return lines.join(' \\\n');
};

export function money(minor: string, currency: string, scale = 2) {
  const amount = BigInt(minor);
  const absoluteAmount = amount < 0n ? -amount : amount;
  const divisor = 10n ** BigInt(scale);
  const whole = absoluteAmount / divisor;
  const fraction = absoluteAmount % divisor;
  const formattedFraction = scale ? `.${fraction.toString().padStart(scale, '0')}` : '';

  return `${amount < 0n ? '-' : ''}${whole}${formattedFraction} ${currency}`;
}

export function toMinor(value: string, scale: number): string {
  const amountPattern = new RegExp(`^\\d+(?:\\.\\d{1,${Math.max(1, scale)}})?$`);
  if (!amountPattern.test(value) || (scale === 0 && value.includes('.'))) {
    throw new Error(`Enter a positive amount with up to ${scale} decimal places`);
  }

  const [whole, fraction = ''] = value.split('.');
  const minorAmount =
    BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, '0') || '0');
  if (minorAmount <= 0n) throw new Error('Amount must be positive');

  return minorAmount.toString();
}

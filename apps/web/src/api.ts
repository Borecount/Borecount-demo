import type * as Contract from './generated-contract';
export type Json = Contract.Json;
export interface DemoRequest { method: 'GET' | 'POST'; path: string; body?: Record<string, Json>; }
export interface RequestRecord { id: number; request: DemoRequest; status: number; response: Json; duration: number; requestId: string | null; foreground?: boolean; }
export interface Page<T> { data: T[]; next_cursor: string | null; }
export type Ledger = Contract.Ledger;
export type Account = Contract.Account;
export type Entry = Contract.EntriesPage['data'][number];
export type Transaction = Contract.Transaction;
export type Hold = Contract.HoldSummary;
export interface Session { access_token: string; expires_in: number; tenant_id: string; session_expires_at: string; assets: { code: string; scale: number }[]; }
export type Balance = Contract.BalanceAsOfResponse;
export class DemoApiError extends Error {
  constructor(public status: number, public payload: Json) { super(typeof payload === 'object' && payload !== null && !Array.isArray(payload) ? `${payload.error ?? 'ERROR'}: ${payload.message ?? 'Request failed'}` : 'Request failed'); }
}
let token = '';
let observer: (record: RequestRecord) => void = () => {};
let recordId = 0;
export function redact(value: Json): Json {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) =>
    [key, /^(access_token|api_key|authorization|x-api-key|token_hash)$/i.test(key) ? '[redacted]' : redact(child)]));
  return value;
}
export function recordExternal(record: Omit<RequestRecord, 'id'>) { observer({ ...record, id: ++recordId, response: redact(record.response) }); }

export const observeRequests = (next: typeof observer) => { observer = next; return () => { observer = () => {}; }; };
export const setAccessToken = (value: string) => { token = value; };
export async function request<T = Record<string, Json>>(operation: DemoRequest, signal?: AbortSignal, foreground = false): Promise<T> {
  // Only local documented surfaces can receive the sandbox credential.
  if (!/^\/(?:v1\/|demo\/session(?:[/?]|$))/.test(operation.path) || operation.path.includes('\\') || operation.path.includes('#')) throw new Error('Use a local /v1/ or sandbox path');
  const url = new URL(operation.path, window.location.origin);
  if (url.origin !== window.location.origin || !/^\/(?:v1\/|demo\/session(?:[/?]|$))/.test(url.pathname)) throw new Error('Use a local API endpoint');
  const start = performance.now();
  let status = 0;
  let responseBody: Json = null;
  let requestId: string | null = null;
  try {
    const response = await fetch(url.pathname + url.search, {
      method: operation.method, signal, credentials: 'same-origin',
      headers: { ...(token && operation.path.startsWith('/v1/') ? { authorization: `Bearer ${token}` } : {}),
        ...(operation.body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: operation.body === undefined ? undefined : JSON.stringify(operation.body),
    });
    status = response.status;
    requestId = response.headers.get('x-request-id');
    const raw = await response.text();
    try { responseBody = raw ? JSON.parse(raw) : null; } catch { responseBody = raw; }
    if (!response.ok) throw new DemoApiError(status, responseBody);
    return responseBody as T;
  } finally {
    // Session responses contain a token; never put credentials into the request journal.
    const safe = redact(responseBody);
    if (!signal?.aborted) observer({ id: ++recordId, request: structuredClone(operation), status, response: safe, requestId, foreground, duration: Math.round(performance.now() - start) });
  }
}
export const query = (path: string, values: Record<string, string | number | undefined>) => {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => { if (value !== undefined && value !== '') params.set(key, String(value)); });
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
  if (operation.path.startsWith('/v1/')) lines.push('  -H "Authorization: Bearer $ACCESS_TOKEN"');
  if (operation.body !== undefined) {
    lines.push("  -H 'content-type: application/json'");
    lines.push(`  --data ${shellSingleQuote(JSON.stringify(operation.body))}`);
  }
  return lines.join(' \\\n');
};
export function money(minor: string, currency: string, scale = 2) {
  const n = BigInt(minor), a = n < 0n ? -n : n, divisor = 10n ** BigInt(scale);
  return `${n < 0n ? '-' : ''}${a / divisor}${scale ? '.' + (a % divisor).toString().padStart(scale, '0') : ''} ${currency}`;
}
export function toMinor(value: string, scale: number): string {
  if (!new RegExp(`^\\d+(?:\\.\\d{1,${Math.max(1, scale)}})?$`).test(value) || (scale === 0 && value.includes('.'))) throw new Error(`Enter a positive amount with up to ${scale} decimal places`);
  const [whole, fraction = ''] = value.split('.');
  const result = BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, '0') || '0');
  if (result <= 0n) throw new Error('Amount must be positive');
  return result.toString();
}

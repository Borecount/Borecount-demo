import type { Json } from './api';
export const formatJson = (value: unknown) => JSON.stringify(value, null, 2);
export const newReference = () => `demo-${crypto.randomUUID().slice(0, 8)}`;
export const initialIds = { tx: '', hold: '', grant: '', upload: '', rule: '', run: '' };
export const asObject = (value: Json): Record<string, Json> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

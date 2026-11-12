/**
 * Each public service call has one REST counterpart for the console's shared
 * controls. This allowlist also defines which methods the demo server can run.
 * Input shapes vary by operation and are validated against canonical schemas
 * before execution, so the editor stores their JSON fields dynamically.
 */
export interface LibraryCall {
  operation: string;
  input: Record<string, any>;
}

export interface RestRequest {
  method: 'GET' | 'POST';
  path: string;
  body?: Record<string, any>;
}

export interface LibraryOperation {
  operation: string;
  method: 'GET' | 'POST';
  path: string;
  parameter?: string;
  // Most services accept an input object. getById-style readers instead take
  // tenantId and a resource ID as separate positional arguments.
  positional?: boolean;
}

/** JSON envelope shared by the server runner and browser transport. */
export interface LibraryExecutionResponse<Value = unknown> {
  result: Value;
  value: Value;
  call: LibraryCall;
}

/** Trusted host context returned only after checking the session cookie. */
export interface SandboxIdentity {
  tenant_id: string;
  api_key_id: string;
}

export interface SandboxSession extends SandboxIdentity {
  expires_at: Date | string;
}

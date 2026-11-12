import { libraryCode, type LibraryCall } from '../api';

// Invalid edits are expected while typing. Keep the preview recoverable until
// the user submits, when the server returns the authoritative validation error.
export function LibraryPreview({
  call,
  tenantId,
  actorId,
}: {
  call: () => LibraryCall;
  tenantId?: string;
  actorId?: string;
}) {
  try {
    return <pre data-testid="library-preview">{libraryCode(call(), tenantId, actorId)}</pre>;
  } catch {
    return <p className="muted">Enter valid arguments to preview the TypeScript example.</p>;
  }
}

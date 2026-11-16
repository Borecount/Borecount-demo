// Never log raw messages, details, SQL, URLs, credentials, stacks or arbitrary error codes.
const categories = {
  '42501': 'permission', '28P01': 'authentication', '28000': 'authentication',
  '42P01': 'missing_schema', '3F000': 'missing_schema', '42883': 'missing_function',
  '3D000': 'wrong_target', '55P03': 'lock_timeout', '57014': 'query_timeout',
  '40P01': 'deadlock', '40001': 'serialization', '53300': 'connection_capacity',
  '57P01': 'database_unavailable', '08000': 'connection', '08001': 'connection',
  '08003': 'connection', '08004': 'connection', '08006': 'connection', '08007': 'connection',
  '08P01': 'connection', 'P0001': 'safety_guard', '22023': 'configuration',
  P1301: 'wrong_target', P1302: 'missing_marker', P1303: 'non_sandbox_data', P1304: 'schema_drift',
  ECONNREFUSED: 'connection', ECONNRESET: 'connection', ETIMEDOUT: 'connection_timeout',
  ENOTFOUND: 'dns', EAI_AGAIN: 'dns',
  CLEANUP_OVERDUE: 'cleanup_overdue', MISSING_MARKER: 'missing_marker',
  INVALID_STATUS: 'invalid_status', DEADLINE_EXCEEDED: 'timeout',
  MIGRATION_HISTORY_MISMATCH: 'migration_history', CONFIGURATION_INVALID: 'configuration',
};
export function safeDatabaseFailure(error) {
  for (let depth = 0, current = error; current && depth < 4; depth++, current = current.cause) {
    if (typeof current.code === 'string' && Object.hasOwn(categories, current.code)) {
      return { code: current.code, category: categories[current.code] };
    }
  }
  return { code: 'UNKNOWN', category: 'unknown' };
}

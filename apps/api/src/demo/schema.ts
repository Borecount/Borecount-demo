// Compose the released ledger schema with the host-owned sandbox lifecycle table.
export * from '@borecount/postgres-adapter/schema';
import { apiKeys, tenants } from '@borecount/postgres-adapter/schema';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
export const demoSessions = pgTable('demo_sessions', {
  id: uuid('id').primaryKey().default(sql`uuid_v7()`),
  tokenHash: text('token_hash').notNull().unique(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  apiKeyId: uuid('api_key_id').notNull().references(() => apiKeys.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, table => ({ expiry: index('demo_sessions_expiry_idx').on(table.expiresAt) }));

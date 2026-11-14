-- Run as the migration owner after migrating. This profile accepts disposable test data ONLY.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'luxledger_demo_hosted' OR current_user <> 'borecount_demo_owner' THEN
    RAISE EXCEPTION 'Wrong public demo database or migration role';
  END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS demo_ops AUTHORIZATION borecount_demo_owner;
REVOKE ALL ON SCHEMA demo_ops FROM PUBLIC;
GRANT USAGE ON SCHEMA demo_ops TO borecount_demo_runtime, borecount_demo_cleanup;
CREATE TABLE IF NOT EXISTS demo_ops.state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  purpose text NOT NULL CHECK (purpose = 'borecount-disposable-public-demo'),
  last_reset_at timestamptz NOT NULL DEFAULT now(),
  next_reset_at timestamptz NOT NULL DEFAULT now() + interval '24 hours'
);
INSERT INTO demo_ops.state (purpose) VALUES ('borecount-disposable-public-demo') ON CONFLICT DO NOTHING;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO borecount_demo_runtime;

-- API can perform financial workflows but cannot migrate, reset, or bypass RLS.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO borecount_demo_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO borecount_demo_runtime;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO borecount_demo_runtime;

CREATE OR REPLACE FUNCTION demo_ops.public_status() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object('purpose', purpose, 'last_reset_at', last_reset_at, 'next_reset_at', next_reset_at)
  FROM demo_ops.state WHERE singleton AND purpose = 'borecount-disposable-public-demo'
$$;
REVOKE ALL ON FUNCTION demo_ops.public_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION demo_ops.public_status() TO borecount_demo_runtime, borecount_demo_cleanup;

-- Whole disposable installation reset, not tenant-history deletion. No CASCADE, dynamic names,
-- caller-selected database, privileged worker credential, or production connection is supported.
CREATE OR REPLACE FUNCTION demo_ops.cleanup_due() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE deadline timestamptz;
BEGIN
  IF current_database() <> 'luxledger_demo_hosted' THEN RAISE EXCEPTION 'Wrong cleanup target'; END IF;
  IF NOT pg_try_advisory_xact_lock(133132) THEN RETURN false; END IF;
  SELECT next_reset_at INTO deadline FROM demo_ops.state
    WHERE singleton AND purpose = 'borecount-disposable-public-demo' FOR UPDATE;
  IF deadline IS NULL THEN RAISE EXCEPTION 'Missing disposable marker'; END IF;
  IF now() < deadline THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.tenants t WHERE NOT EXISTS
    (SELECT 1 FROM public.demo_sessions s WHERE s.tenant_id = t.id)) OR
    EXISTS (SELECT 1 FROM public.api_keys WHERE role <> 'SERVICE') THEN
    RAISE EXCEPTION 'Cleanup refused: database contains non-sandbox identities';
  END IF;
  IF (SELECT array_agg(tablename::text ORDER BY tablename) FROM pg_catalog.pg_tables WHERE schemaname = 'public')
    IS DISTINCT FROM ARRAY['accounts', 'api_keys', 'assets', 'balance_snapshots',
      'credit_grant_capacity_versions', 'credit_grant_entries', 'credit_grant_hold_allocations',
      'credit_grants', 'demo_sessions', 'entries', 'hold_entries', 'holds', 'ledgers',
      'recon_records', 'recon_results', 'recon_rules', 'recon_runs', 'recon_uploads', 'tenants', 'transactions'] THEN
    RAISE EXCEPTION 'Cleanup refused: unexpected public schema';
  END IF;
  TRUNCATE TABLE public.accounts, public.api_keys, public.assets, public.balance_snapshots,
    public.credit_grant_capacity_versions, public.credit_grant_entries, public.credit_grant_hold_allocations,
    public.credit_grants, public.demo_sessions, public.entries, public.hold_entries, public.holds,
    public.ledgers, public.recon_records, public.recon_results, public.recon_rules, public.recon_runs,
    public.recon_uploads, public.tenants, public.transactions;
  UPDATE demo_ops.state SET last_reset_at = now(), next_reset_at = now() + interval '24 hours' WHERE singleton;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION demo_ops.cleanup_due() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION demo_ops.cleanup_due() TO borecount_demo_cleanup;
COMMIT;

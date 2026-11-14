-- Upgrade OUR EXISTING dedicated demo DB. No database/schema reset or data deletion.
-- Run as its current managed admin, before changing Render's runtime credential.
BEGIN;
SET LOCAL lock_timeout = '2s';
DO $$
BEGIN
  IF current_database() <> 'luxledger_demo_hosted' THEN RAISE EXCEPTION 'Wrong demo database'; END IF;
  IF (SELECT array_agg(tablename::text ORDER BY tablename) FROM pg_tables WHERE schemaname = 'public')
    IS DISTINCT FROM ARRAY['accounts','api_keys','assets','balance_snapshots',
      'credit_grant_capacity_versions','credit_grant_entries','credit_grant_hold_allocations',
      'credit_grants','demo_sessions','entries','hold_entries','holds','ledgers','recon_records',
      'recon_results','recon_rules','recon_runs','recon_uploads','tenants','transactions'] THEN
    RAISE EXCEPTION 'Unreviewed schema; do not adopt automatically';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tenants t WHERE NOT EXISTS
    (SELECT 1 FROM public.demo_sessions s WHERE s.tenant_id=t.id)) OR
    EXISTS (SELECT 1 FROM public.api_keys WHERE role <> 'SERVICE') THEN
    RAISE EXCEPTION 'Non-sandbox identities require review';
  END IF;
END $$;
CREATE ROLE borecount_demo_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE borecount_demo_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE borecount_demo_cleanup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
-- No passwords are set here. Their secure entry is a separate user-owned step.
GRANT CONNECT ON DATABASE luxledger_demo_hosted TO borecount_demo_owner, borecount_demo_runtime, borecount_demo_cleanup;
GRANT CREATE ON DATABASE luxledger_demo_hosted TO borecount_demo_owner;
DO $$
DECLARE item record;
BEGIN
  EXECUTE format('GRANT borecount_demo_owner TO %I', current_user);
  -- PostgreSQL requires the new owner to have CREATE on each schema before table transfer.
  -- Managed Neon admins are not real superusers, so ordering matters.
  ALTER SCHEMA public OWNER TO borecount_demo_owner;
  ALTER SCHEMA drizzle OWNER TO borecount_demo_owner;
  FOR item IN SELECT schemaname, tablename FROM pg_tables WHERE schemaname IN ('public','drizzle') LOOP
    EXECUTE format('ALTER TABLE %I.%I OWNER TO borecount_demo_owner', item.schemaname, item.tablename);
  END LOOP;
  FOR item IN SELECT schemaname, sequencename FROM pg_sequences WHERE schemaname IN ('public','drizzle') LOOP
    EXECUTE format('ALTER SEQUENCE %I.%I OWNER TO borecount_demo_owner', item.schemaname, item.sequencename);
  END LOOP;
  FOR item IN SELECT p.oid::regprocedure AS identity FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND NOT EXISTS
      (SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e') LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO borecount_demo_owner', item.identity);
  END LOOP;
END $$;
ALTER ROLE borecount_demo_runtime SET statement_timeout = '15s';
ALTER ROLE borecount_demo_runtime SET lock_timeout = '2s';
ALTER ROLE borecount_demo_runtime SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE borecount_demo_cleanup SET statement_timeout = '30s';
ALTER ROLE borecount_demo_cleanup SET lock_timeout = '2s';
ALTER ROLE borecount_demo_cleanup SET idle_in_transaction_session_timeout = '30s';
COMMIT;
-- Then run prepare.sql as SET ROLE borecount_demo_owner in the same SQL session.
-- Keep the existing Render credential active until the replacement is verified.

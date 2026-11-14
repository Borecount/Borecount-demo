-- Run via psql against the DEFAULT database of a NEW dedicated Neon demo project.
-- Never run against the production project or a branch cloned from production.
-- psql prompts keep passwords out of shell arguments/history. Use 32 random-byte hex values.
\set ON_ERROR_STOP on
-- SQL-created roles do not inherit neon_superuser, unlike console/API-created admin roles.
CREATE ROLE borecount_demo_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE borecount_demo_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE borecount_demo_cleanup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
\password borecount_demo_owner
\password borecount_demo_runtime
\password borecount_demo_cleanup
-- The managed admin must be able to transfer ownership / create a database for this owner.
-- GRANT is made to this setup session's admin only, never to runtime or cleanup.
SELECT format('GRANT borecount_demo_owner TO %I', current_user) \gexec
CREATE DATABASE luxledger_demo_hosted OWNER borecount_demo_owner;
REVOKE ALL ON DATABASE luxledger_demo_hosted FROM PUBLIC;
GRANT CONNECT ON DATABASE luxledger_demo_hosted TO borecount_demo_owner, borecount_demo_runtime, borecount_demo_cleanup;
-- This is a dedicated project: deny the two operational roles access to all other user DBs.
SELECT format('REVOKE CONNECT, TEMPORARY ON DATABASE %I FROM PUBLIC', datname)
FROM pg_database WHERE NOT datistemplate AND datname <> 'luxledger_demo_hosted' \gexec
ALTER ROLE borecount_demo_runtime SET statement_timeout = '15s';
ALTER ROLE borecount_demo_runtime SET lock_timeout = '2s';
ALTER ROLE borecount_demo_runtime SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE borecount_demo_cleanup SET statement_timeout = '30s';
ALTER ROLE borecount_demo_cleanup SET lock_timeout = '2s';
ALTER ROLE borecount_demo_cleanup SET idle_in_transaction_session_timeout = '30s';
-- Connect to luxledger_demo_hosted as borecount_demo_owner next; run npm run db:prepare:public.

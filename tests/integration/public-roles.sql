-- Only installed in the isolated Compose cluster, never in a SaaS cluster.
CREATE ROLE borecount_demo_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD :'owner_password';
CREATE ROLE borecount_demo_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD :'runtime_password';
CREATE ROLE borecount_demo_cleanup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD :'cleanup_password';
REVOKE CONNECT, TEMPORARY ON DATABASE postgres FROM PUBLIC;
REVOKE CONNECT, TEMPORARY ON DATABASE template1 FROM PUBLIC;
REVOKE ALL ON DATABASE luxledger_demo_hosted FROM PUBLIC;
GRANT CONNECT ON DATABASE luxledger_demo_hosted TO borecount_demo_owner, borecount_demo_runtime, borecount_demo_cleanup;
GRANT CREATE ON DATABASE luxledger_demo_hosted TO borecount_demo_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO borecount_demo_owner;
GRANT USAGE ON SCHEMA public TO borecount_demo_runtime;
ALTER ROLE borecount_demo_runtime SET statement_timeout = '15s';
ALTER ROLE borecount_demo_runtime SET lock_timeout = '2s';
ALTER ROLE borecount_demo_runtime SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE borecount_demo_cleanup SET statement_timeout = '30s';
ALTER ROLE borecount_demo_cleanup SET lock_timeout = '2s';
ALTER ROLE borecount_demo_owner SET idle_in_transaction_session_timeout = '30s';

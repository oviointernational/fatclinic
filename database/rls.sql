-- ============================================================================
-- FatClinic EHR — Row Level Security (Supabase)
-- ============================================================================
-- REQUIRED before the anon key ever reaches a browser. Without this file the
-- published anon key grants anyone full read/write access to every table via
-- PostgREST, including all patient records.
--
-- Apply AFTER database/fatclinic.sql, in the Supabase SQL editor:
--   psql "$DATABASE_URL" -f database/rls.sql
--
-- Model: staff sign in with Supabase Auth. Identity is the JWT; the app's own
-- role lives in public.users and is matched by email. Authenticated staff may
-- read/write clinical data; a small set of administrative tables is restricted
-- to role = 'ADMINISTRATOR'.
--
-- Idempotent: safe to re-run.
--
-- NOTE: this file references the `auth` schema, so it is a no-op on a plain
-- Postgres server (e.g. a local dev database).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Helper: the signed-in staff member's app role, resolved from the JWT email.
--
-- SECURITY DEFINER because the policies below run as the calling role, which
-- cannot read public.users (it is itself behind RLS) without recursing.
-- Returns NULL for signed-out or unrecognised callers.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.role
    FROM public.users u
   WHERE lower(u.email) = lower(auth.jwt() ->> 'email')
     AND u.active
   LIMIT 1;
$$;

COMMENT ON FUNCTION public.app_user_role() IS
  'App role of the signed-in staff member (matched from the Supabase JWT email), or NULL. Used by RLS policies.';

-- Convenience wrapper so policies read clearly.
CREATE OR REPLACE FUNCTION public.app_is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT public.app_user_role() = 'ADMINISTRATOR';
$$;

-- ----------------------------------------------------------------------------
-- Table policy matrix
--   'admin'      -> readable by all staff, writable by administrators only
--   'staff'      -> full read/write for any authenticated staff member
--   'append'     -> insert + read only (immutable audit trail)
-- ----------------------------------------------------------------------------

-- Clinical and operational data: any authenticated staff member.
-- audit_logs is deliberately absent - it is append-only.
DO $$
DECLARE
  t TEXT;
  staff_tables TEXT[] := ARRAY[
    'wards', 'patients', 'visits', 'vitals', 'consultations', 'clinical_diagnoses',
    'lab_investigations', 'lab_parameters', 'lab_requests', 'lab_test_orders',
    'lab_results', 'medications', 'prescriptions', 'prescription_items',
    'invoices', 'invoice_items', 'payments', 'online_bookings',
    'lab_stock_items', 'lab_stock_requests', 'radiology_orders',
    'physiotherapy_orders', 'clinical_consumables', 'consumable_requests',
    'consumable_usage', 'medication_requests'
  ];
  admin_tables TEXT[] := ARRAY[
    'users', 'custom_roles', 'role_permissions', 'permission_nodes',
    'system_settings', 'receipt_settings', 'service_prices'
  ];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN
    RAISE NOTICE 'auth schema not found - skipping FatClinic RLS (not a Supabase project)';
    RETURN;
  END IF;

  -- Staff tables: enable RLS, then grant full access to signed-in staff only.
  FOREACH t IN ARRAY staff_tables LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)', t || '_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (true)', t || '_insert', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (true) WITH CHECK (true)', t || '_update', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (true)', t || '_delete', t);
  END LOOP;

  -- Administrative tables: all staff may read, only administrators may write.
  FOREACH t IN ARRAY admin_tables LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_delete', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)', t || '_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.app_is_admin())', t || '_insert', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.app_is_admin()) WITH CHECK (public.app_is_admin())', t || '_update', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.app_is_admin())', t || '_delete', t);
  END LOOP;

  -- Audit trail: append-only. No UPDATE/DELETE policy is ever created, and the
  -- prevent_audit_mutation() trigger from fatclinic.sql blocks it a second
  -- time at the database level.
  IF to_regclass('public.audit_logs') IS NOT NULL THEN
    ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.audit_logs FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS audit_logs_select ON public.audit_logs;
    DROP POLICY IF EXISTS audit_logs_insert ON public.audit_logs;
    DROP POLICY IF EXISTS audit_logs_update ON public.audit_logs;
    DROP POLICY IF EXISTS audit_logs_delete ON public.audit_logs;
    CREATE POLICY audit_logs_select ON public.audit_logs
      FOR SELECT TO authenticated USING (true);
    CREATE POLICY audit_logs_insert ON public.audit_logs
      FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Grants. RLS is the real gate; these make the intent explicit and stop the
-- anon role from reaching the tables at all.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN
    RETURN;
  END IF;

  REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;

  -- The role lookup must not be callable directly by clients; policies invoke it.
  REVOKE ALL ON FUNCTION public.app_user_role() FROM PUBLIC;
  REVOKE ALL ON FUNCTION public.app_is_admin() FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION public.app_user_role() TO authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.app_is_admin() TO authenticated, service_role;

  -- Cover tables created later.
  ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public
    REVOKE ALL ON TABLES FROM anon;
END $$;

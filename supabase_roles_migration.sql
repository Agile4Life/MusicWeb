-- Migration: server-side persistent account approval via `roles` table.
-- Run this in Supabase Dashboard > SQL Editor.
-- Purpose: after passkey/register approval, the email is stored here so NextAuth
-- signIn accepts the Google account from ANY browser/device (not just the cookie
-- of the browser that entered the passkey).

CREATE TABLE IF NOT EXISTS public.roles (
  email TEXT PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'user',
  roleApproved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Approvals are written/read via the service-role key, so RLS can stay locked down.
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'roles' AND policyname = 'service_role_all_roles'
  ) THEN
    CREATE POLICY service_role_all_roles ON public.roles
      FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

-- Backfill: approve every Gmail that is already in the config allowlist.
INSERT INTO public.roles (email, role, roleApproved)
SELECT lower(TRIM(e)), 'user', true
FROM (
  SELECT UNNEST(ARRAY[
    'admin@gmail.com',
    'admin@musicweb.com',
    'tranphong16012006@gmail.com',
    'pnnd2006@gmail.com',
    'hoangletran50@gmail.com',
    'hoangletran1231203@gmail.com',
    'user@musicweb.com',
    'listener@gmail.com',
    'tuanphong@homeviet.com'
  ]) AS e
) src
ON CONFLICT (email) DO UPDATE SET roleApproved = true;

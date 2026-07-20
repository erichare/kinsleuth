-- Widens the public-demo session notice-version constraint so sessions
-- accepted under the 2026-07-16 notice remain valid while new sessions record
-- the 2026-07-20 notice that names Plausible Analytics on the landing page.
-- Published migrations are immutable, so 018's single-version CHECK is
-- replaced here instead of being edited in place.
--
-- Numbering note: 020_core_rls_policies.sql is owned by the unmerged
-- feat/core-rls-policies branch; this migration deliberately takes 021 and
-- must merge after that branch lands.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5min';

ALTER TABLE public.public_demo_sessions
  DROP CONSTRAINT public_demo_sessions_notice_version_check;
ALTER TABLE public.public_demo_sessions
  ADD CONSTRAINT public_demo_sessions_notice_version_check CHECK (
    notice_version IN ('public-demo-2026-07-16', 'public-demo-2026-07-20')
  );

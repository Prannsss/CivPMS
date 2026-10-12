-- Database advisor follow-up.
-- invite_code_attempts is server-only (rate limiting): no grants to clients.
-- Make the intent explicit with a deny-all policy (lint 0008 rls_enabled_no_policy).
-- The remaining advisor findings are by design and documented in docs/DATABASE.md:
--   * 0028 anon can execute public.get_invitation_by_token (invite landing page)
--   * 0029 authenticated can execute the SECURITY DEFINER RPCs (RPC-only writes,
--     each RPC checks the caller's role itself)
--   * 0005 unused indexes (foreign-key / policy indexes on a still-empty database)

create policy invite_code_attempts_no_client_access on public.invite_code_attempts
  for all to anon, authenticated
  using (false)
  with check (false);

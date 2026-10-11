-- ---------------------------------------------------------------------------
-- 003 — evidence requests may be raised by the automated verification engine
--
-- `evidence_requests.requested_by` was NOT NULL, which assumed that every
-- request for extra evidence comes from a moderator. The preliminary
-- verification engine also raises requests (for example when the ownership
-- evidence is missing), and there is no human requester in that case.
--
-- A NULL `requested_by` therefore means "raised automatically by the
-- verification engine". Human requests keep recording the administrator's id,
-- and the moderation history distinguishes the two.
-- ---------------------------------------------------------------------------

ALTER TABLE evidence_requests ALTER COLUMN requested_by DROP NOT NULL;

COMMENT ON COLUMN evidence_requests.requested_by IS
  'Administrator who requested the evidence, or NULL when the verification engine raised the request automatically.';

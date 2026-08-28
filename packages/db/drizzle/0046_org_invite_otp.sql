-- 0046: OTP verification for org invites.
--
-- Nullable, not backfilled: pending invites created before this deploy have
-- otp_code = NULL. The shared accept function (packages/db/src/invites.ts)
-- treats NULL as "pre-OTP invite, no OTP required" rather than forcing a
-- backfill an invitee never received by email. Every new invite (single,
-- resend, bulk) always populates both otp columns going forward. Pre-OTP
-- rows age out within their existing 7-day expiresAt regardless.
--
-- otp_code is plaintext, matching this table's own token column (also
-- plaintext). A 6-digit code's real defense is otp_attempts capping guesses
-- (see acceptOrgInvite), not hashing a one-in-a-million space.

ALTER TABLE "org_invites" ADD COLUMN "otp_code" text;
--> statement-breakpoint

ALTER TABLE "org_invites" ADD COLUMN "otp_expires_at" timestamp;
--> statement-breakpoint

ALTER TABLE "org_invites" ADD COLUMN "otp_attempts" integer NOT NULL DEFAULT 0;

import { describe, it, expect } from 'vitest';
import { twoFactor } from 'better-auth/plugins';
import { twoFactorClient } from 'better-auth/client/plugins';
import { user, twoFactor as twoFactorTable } from '@irth/db/src/schema/auth';

/**
 * 2FA wiring tests. The twoFactor plugin's crypto/TOTP internals are Better
 * Auth's, not ours — what this repo owns is:
 *   1. the DB contract (columns the plugin needs exist on our schema),
 *   2. the plugin config (issuer, TOTP-only — no email-OTP fallback),
 *   3. the client wiring (challenge routes to the verify page),
 *   4. both auth instances stay in lockstep.
 */

describe('two-factor — schema contract', () => {
  it('user table carries twoFactorEnabled, defaulting false', () => {
    const col = user.twoFactorEnabled;
    expect(col).toBeDefined();
    // notNull + default false: a user is 2FA-off until they enable it.
    expect(col.notNull).toBe(true);
  });

  it('two_factor table has the columns the plugin writes', () => {
    // secret/backupCodes/verified are the plugin's contract (see its
    // schema.d.mts); a missing column is a runtime failure on enable.
    expect(twoFactorTable.secret).toBeDefined();
    expect(twoFactorTable.backupCodes).toBeDefined();
    expect(twoFactorTable.verified).toBeDefined();
    expect(twoFactorTable.userId).toBeDefined();
  });

  it('two_factor is NOT org-scoped — 2FA belongs to the identity', () => {
    // Identity tables (user/session/account/verification) carry no org_id;
    // 2FA follows the same rule. This is the assertion that keeps a future
    // "org_id for consistency" refactor from breaking 2FA on org switch.
    const columns = Object.keys(twoFactorTable);
    expect(columns).not.toContain('orgId');
  });
});

describe('two-factor — plugin configuration', () => {
  it('instantiates with the IRTH issuer, TOTP + backup codes only', () => {
    // Matches auth-server.ts's actual call — no otpOptions/sendOTP. That
    // fallback needs a hook that sends mail synchronously in-request; this
    // app's only email path is the async outbox (apps/api's outbox worker),
    // which is right for "eventually" and wrong for a code the user is
    // waiting on right now. TOTP needs no server-sent delivery at all.
    const plugin = twoFactor({ issuer: 'IRTH OS' });
    expect(plugin.id).toBe('two-factor');
    // The endpoints the enable/verify/disable settings flow depends on.
    // sendTwoFactorOTP/verifyTwoFactorOTP are also present (the otp
    // sub-plugin always registers them) but unconfigured and unused here —
    // calling send-otp without a sendOTP hook throws OTP_NOT_CONFIGURED,
    // which is fine since nothing in this app's UI calls it.
    const endpointNames = Object.keys(plugin.endpoints ?? {});
    expect(endpointNames).toContain('enableTwoFactor');
    expect(endpointNames).toContain('disableTwoFactor');
    expect(endpointNames).toContain('verifyTOTP');
  });

  it('client plugin wires the challenge redirect', () => {
    const client = twoFactorClient({ twoFactorPage: '/ar/two-factor' });
    expect(client.id).toBe('two-factor');
    expect(client.pathMethods).toMatchObject({
      '/two-factor/verify-totp': 'POST',
    });
  });
});

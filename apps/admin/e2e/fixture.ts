/** The one org, owner and orders the smoke test runs against. */
export const OWNER = {
  name: 'E2E Owner',
  email: 'e2e-owner@irth.test',
  password: 'e2e-Password-1234',
};

export const ORG_SLUG = 'e2e-smoke';

export const LINKED_GID = 'gid://shopify/ProductVariant/7001';

export const BLOCKED_ORDER_NUMBER = 'E2E-BLOCKED-1';
export const BUYER_NAME = 'منى علي';
export const UNMAPPED_LINE = 'سيروم 50 مل';

/** The account the owner creates on the members screen (PR-1d). */
export const REP_USERNAME = '01000000077';
export const REP_NEW_PASSWORD = 'Rep-Password-2026';

/** The delivery rep the owner creates from the role template (PR-2a), and their order. */
export const DRIVER_USERNAME = '01000000088';
export const DRIVER_PASSWORD = 'Driver-Password-2026';
export const COD_ORDER_NUMBER = 'E2E-COD-1';

/**
 * The owner's signed-in browser state, written once by seed.setup.ts. Better
 * Auth rate-limits /sign-in/email (3 per 10 s in production mode), so every
 * test signing in through the form would trip it; only the login test does.
 */
export const OWNER_STATE = 'e2e/.auth/owner.json';

import { describe, expect, it } from 'vitest';
import {
  ACTIVE_ORGANIZATION_COOKIE,
  isOrganizationId,
  parseActiveOrganizationId,
} from './activeOrganization';

describe('active organization cookie', () => {
  const orgId = '11111111-1111-4111-8111-111111111111';

  it('accepts a valid UUID', () => {
    expect(isOrganizationId(orgId)).toBe(true);
  });

  it('rejects malformed values', () => {
    expect(isOrganizationId('not-an-org')).toBe(false);
    expect(parseActiveOrganizationId(`${ACTIVE_ORGANIZATION_COOKIE}=not-an-org`)).toBeNull();
  });

  it('extracts the selected organization from a cookie header', () => {
    expect(parseActiveOrganizationId(`foo=bar; ${ACTIVE_ORGANIZATION_COOKIE}=${orgId}; theme=dark`)).toBe(orgId);
  });

  it('does not trust a similarly-prefixed cookie', () => {
    expect(parseActiveOrganizationId(`${ACTIVE_ORGANIZATION_COOKIE}_attacker=${orgId}`)).toBeNull();
  });
});

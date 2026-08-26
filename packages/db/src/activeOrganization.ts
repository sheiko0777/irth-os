export const ACTIVE_ORGANIZATION_COOKIE = 'irth.active_org';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isOrganizationId(value: string | null | undefined): value is string {
  return !!value && UUID_RE.test(value);
}

export function parseActiveOrganizationId(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  const pair = cookieHeader.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${ACTIVE_ORGANIZATION_COOKIE}=`));
  if (!pair) return null;
  const value = decodeURIComponent(pair.slice(ACTIVE_ORGANIZATION_COOKIE.length + 1));
  return isOrganizationId(value) ? value : null;
}

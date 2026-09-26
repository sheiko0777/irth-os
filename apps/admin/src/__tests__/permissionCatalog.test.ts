/**
 * Every resource.action the server enforces must appear, labelled, on the
 * roles screen — otherwise the owner cannot grant or revoke it, and a new
 * screen would ship invisible to the permission builder.
 */
import { describe, expect, it } from 'vitest';
import { PERMISSIONS, type Resource } from '@irth/db/src/permissions';
import { RESOURCE_LABELS, catalog, hasActionLabel } from '@/lib/permissionCatalog';

describe('permission catalog', () => {
  it('labels every resource the matrix declares, and nothing else', () => {
    expect(Object.keys(RESOURCE_LABELS).sort()).toEqual(Object.keys(PERMISSIONS).sort());
  });

  it('labels every declared action', () => {
    const missing = (Object.keys(PERMISSIONS) as Resource[]).flatMap((resource) =>
      Object.keys(PERMISSIONS[resource]).filter((action) => !hasActionLabel(resource, action)).map((a) => `${resource}.${a}`));
    expect(missing).toEqual([]);
  });

  it('the catalog lists every declared pair exactly once', () => {
    const pairs = catalog().flatMap(({ resource, actions }) => actions.map((a) => `${resource}.${a}`));
    const declared = (Object.keys(PERMISSIONS) as Resource[]).flatMap((r) => Object.keys(PERMISSIONS[r]).map((a) => `${r}.${a}`));
    expect(pairs.sort()).toEqual(declared.sort());
  });
});

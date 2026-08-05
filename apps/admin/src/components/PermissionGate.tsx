'use client';

import { ReactNode } from 'react';
import { can, useRole, PERMISSIONS } from '../lib/permissions';

type Resource = keyof typeof PERMISSIONS;

/**
 * The actions actually declared for a given resource.
 *
 * Typed rather than `string` because `can()` fails closed on an unknown action:
 * a typo silently denies everyone instead of erroring. That is safe but
 * invisible, and it is exactly how the categories page shipped asking for
 * `action="read"` when the map declares `view` — the whole table was hidden
 * from every user, owners included, with nothing in the console to say why.
 * Now a wrong verb is a compile error.
 */
type ActionFor<R extends Resource> = keyof (typeof PERMISSIONS)[R];

interface PermissionGateProps<R extends Resource> {
  resource: R;
  action: ActionFor<R>;
  children: ReactNode;
}

export function PermissionGate<R extends Resource>({
  resource,
  action,
  children,
}: PermissionGateProps<R>) {
  const role = useRole();

  if (!role || !can(role, resource, action as string)) {
    return null;
  }

  return <>{children}</>;
}
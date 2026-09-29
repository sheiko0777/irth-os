'use client';

import { ReactNode } from 'react';
import { useCan, PERMISSIONS, type ActionFor } from '../lib/permissions';

type Resource = keyof typeof PERMISSIONS;

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
  // Effective permissions from me.get — the same set the server checks, so a
  // per-person grant shows the control and a revoke hides it.
  const can = useCan();

  if (!can(resource, action)) {
    return null;
  }

  return <>{children}</>;
}
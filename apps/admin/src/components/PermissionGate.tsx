'use client';

import { ReactNode } from 'react';
import { can, useRole, PERMISSIONS, type ActionFor } from '../lib/permissions';

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
  const role = useRole();

  if (!role || !can(role, resource, action)) {
    return null;
  }

  return <>{children}</>;
}
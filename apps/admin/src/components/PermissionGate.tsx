'use client';

import { ReactNode } from 'react';
import { canWithPolicy, useAccess, PERMISSIONS, type ActionFor } from '../lib/permissions';

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
  const { role, accessPolicy, permissionOverrides } = useAccess();

  if (!role || !canWithPolicy(role, resource, action, accessPolicy, permissionOverrides)) {
    return null;
  }

  return <>{children}</>;
}

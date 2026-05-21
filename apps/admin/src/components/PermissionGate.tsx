"use client";

import { ReactNode } from "react";
import { can, useRole, PERMISSIONS } from "../lib/permissions";
import type { Role } from "@irth/db/src/permissions";

interface PermissionGateProps {
  resource: keyof typeof PERMISSIONS;
  action: string;
  children: ReactNode;
}

export function PermissionGate({
  resource,
  action,
  children,
}: PermissionGateProps) {
  const role = useRole();

  if (!role || !can(role, resource, action)) {
    return null;
  }

  return <>{children}</>;
}

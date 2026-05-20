"use client";

import { PermissionGate } from "@/components/PermissionGate";
import { Badge } from "@/components/ui/badge";

export function MemberRoleSelect({ role }: { role: string }) {
  return (
    <div className="flex items-center gap-2">
      <Badge variant="outline">{role}</Badge>
      <PermissionGate resource="members" action="changeRole">
        {/* For Phase 9, we show a select if owner. The logic is a placeholder select for demonstration */}
        {role !== "owner" && (
          <select className="border text-sm p-1 rounded" defaultValue={role}>
            <option value="admin">Admin</option>
            <option value="member">Member</option>
          </select>
        )}
      </PermissionGate>
    </div>
  );
}

'use client';

import { useState } from "react";
import { PermissionGate } from "@/components/PermissionGate";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

export function MemberRoleSelect({ memberId, role }: { memberId: string; role: string }) {
    const [value, setValue] = useState(role);
    const utils = trpc.useUtils();
    const changeRoleMutation = trpc.members.changeRole.useMutation({
        onSuccess: () => {
            toast.success('تم تغيير الدور بنجاح');
            utils.members.list.invalidate();
        },
        onError: (err: unknown) => {
            toast.error(err instanceof Error ? err.message : 'حدث خطأ أثناء تغيير الدور');
            setValue(role); // revert the optimistic selection on failure
        },
    });

    return (
        <div className="flex items-center gap-2">
            <Badge variant="outline">{role}</Badge>
            <PermissionGate resource="members" action="changeRole">
                {role !== 'owner' && (
                    <select
                        className="border text-sm p-1 rounded"
                        value={value}
                        disabled={changeRoleMutation.isPending}
                        onChange={(e) => {
                            const newRole = e.target.value as 'admin' | 'member';
                            setValue(newRole);
                            changeRoleMutation.mutate({ memberId, role: newRole });
                        }}
                    >
                        <option value="admin">Admin</option>
                        <option value="member">Member</option>
                    </select>
                )}
            </PermissionGate>
        </div>
    );
}

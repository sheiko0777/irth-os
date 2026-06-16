'use client';

import { PermissionGate } from "@/components/PermissionGate";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

export function MemberRoleSelect({ memberId, role }: { memberId: string; role: string }) {
    const utils = trpc.useUtils();
    const changeRoleMutation = trpc.members.changeRole.useMutation({
        onSuccess: () => {
            toast.success('تم تغيير الدور بنجاح');
            utils.invalidate();
        },
        onError: (err: unknown) => {
            toast.error(err instanceof Error ? err.message : 'حدث خطأ أثناء تغيير الدور');
        },
    });

    return (
        <div className="flex items-center gap-2">
            <Badge variant="outline">{role}</Badge>
            <PermissionGate resource="members" action="changeRole">
                {role !== 'owner' && (
                    <select
                        className="border text-sm p-1 rounded"
                        defaultValue={role}
                        disabled={changeRoleMutation.isPending}
                        onChange={(e) => changeRoleMutation.mutate({ memberId, role: e.target.value as 'admin' | 'member' })}
                    >
                        <option value="admin">Admin</option>
                        <option value="member">Member</option>
                    </select>
                )}
            </PermissionGate>
        </div>
    );
}

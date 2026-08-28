'use client';

import { PermissionGate } from '@/components/PermissionGate';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';

export function RemoveMemberButton({ memberId, role }: { memberId: string; role: string }) {
  const utils = trpc.useUtils();
  const removeMutation = trpc.members.remove.useMutation({
    onSuccess: () => {
      toast.success('تمت إزالة العضو');
      utils.members.list.invalidate();
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'حدث خطأ أثناء إزالة العضو');
    },
  });

  if (role === 'owner') return null;

  return (
    <PermissionGate resource="members" action="remove">
      <ConfirmDialog
        title="إزالة العضو"
        description="سيفقد هذا الشخص الوصول إلى المؤسسة فوراً."
        confirmLabel="إزالة"
        pending={removeMutation.isPending}
        onConfirm={() => removeMutation.mutate({ memberId })}
      >
        <Button variant="ghost" size="sm" className="text-[var(--crimson)]">
          إزالة
        </Button>
      </ConfirmDialog>
    </PermissionGate>
  );
}

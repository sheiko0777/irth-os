'use client';

import { PermissionGate } from '@/components/PermissionGate';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';

const ROLE_LABEL: Record<string, string> = { owner: 'مالك', admin: 'مدير', member: 'عضو' };

export function PendingInvitesList() {
  const utils = trpc.useUtils();
  const { data } = trpc.members.listInvites.useQuery();
  const invites = data?.data ?? [];

  const resendMutation = trpc.members.resendInvite.useMutation({
    onSuccess: () => {
      toast.success('تم إعادة إرسال الدعوة');
      utils.members.listInvites.invalidate();
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'تعذّر إعادة إرسال الدعوة');
    },
  });

  const revokeMutation = trpc.members.revokeInvite.useMutation({
    onSuccess: () => {
      toast.success('تم إلغاء الدعوة');
      utils.members.listInvites.invalidate();
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'تعذّر إلغاء الدعوة');
    },
  });

  if (invites.length === 0) return null;

  return (
    <PermissionGate resource="members" action="invite">
      <Card>
        <CardHeader>
          <CardTitle>دعوات معلّقة</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {invites.map((invite) => (
              <div
                key={invite.id}
                className="flex items-center justify-between gap-3 border-b border-[var(--rim1)] pb-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-[var(--t1)]" dir="ltr">{invite.email}</p>
                  <p className="text-xs text-[var(--t3)]">
                    {ROLE_LABEL[invite.role] ?? invite.role} · تنتهي في{' '}
                    {new Date(invite.expiresAt).toLocaleDateString('ar-EG')}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={resendMutation.isPending}
                    onClick={() => resendMutation.mutate({ inviteId: invite.id })}
                  >
                    إعادة إرسال
                  </Button>
                  <ConfirmDialog
                    title="إلغاء الدعوة"
                    description={`سيتم إلغاء الدعوة المرسلة إلى ${invite.email}.`}
                    confirmLabel="إلغاء الدعوة"
                    pending={revokeMutation.isPending}
                    onConfirm={() => revokeMutation.mutate({ inviteId: invite.id })}
                  >
                    <Button variant="ghost" size="sm" className="text-[var(--crimson)]">
                      إلغاء
                    </Button>
                  </ConfirmDialog>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </PermissionGate>
  );
}

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { getTranslations } from "next-intl/server";
import { InviteForm } from "./InviteForm";
import { MemberActions } from "./MemberActions";
import { CreateAccountForm } from "./CreateAccountForm";
import { RemoveMemberButton } from "./RemoveMemberButton";
import { PendingInvitesList } from "./PendingInvitesList";
import { PermissionGate } from "@/components/PermissionGate";
import { serverCaller } from "@/server/caller";
import { EmptyState } from '@/components/ui/EmptyState';
import { Users } from 'lucide-react';

export default async function MembersPage() {
  const t = await getTranslations("settings");

  const caller = await serverCaller();
  const [res, me] = await Promise.all([caller.members.list(), caller.me.get()]);
  const members = res.data;

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">{t("members")}</h1>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>الأعضاء الحاليين</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {members.map((member) => (
                <div
                  key={member.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--rim1)] pb-2"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      className="grid size-8 shrink-0 place-items-center rounded-full border border-[var(--gold-br)] bg-[var(--gold-bg)] text-xs font-bold text-[var(--gold)]"
                      aria-hidden="true"
                    >
                      {(member.name ?? member.email ?? '؟').trim().charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      {/* Falls back down the chain rather than showing nothing:
                          a membership can outlive its user row. */}
                      <p className="truncate text-sm text-[var(--t1)]">
                        {member.name ?? member.email ?? 'مستخدم غير معروف'}
                      </p>
                      {/* A directly created account has a username and a
                          placeholder email that never delivers — show the
                          username instead. */}
                      {(member.username || member.email) && (
                        <p className="truncate text-xs text-[var(--t3)]" dir="ltr">
                          {member.username ?? member.email}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <MemberActions
                      isSelf={member.userId === me.data.userId}
                      member={{
                        id: member.id,
                        name: member.name ?? member.username ?? member.email ?? 'عضو',
                        accessRoleId: member.accessRoleId,
                        roleName: member.roleName,
                        systemKey: member.systemKey,
                        status: member.status,
                        mustChangePassword: member.mustChangePassword,
                      }}
                    />
                    <RemoveMemberButton memberId={member.id} role={member.role} />
                  </div>
                </div>
              ))}
              {members.length === 0 && (
                <EmptyState
                  icon={Users}
                  title="لا يوجد أعضاء بعد"
                  hint="ادعُ زميل بالبريد الإلكتروني، وهيظهر هنا بدوره في المؤسسة."
                />
              )}
            </div>
          </CardContent>
        </Card>

        <PermissionGate resource="members" action="create">
          <Card>
            <CardHeader>
              <CardTitle>إنشاء حساب مباشر</CardTitle>
            </CardHeader>
            <CardContent>
              <CreateAccountForm />
            </CardContent>
          </Card>
        </PermissionGate>

        <PermissionGate resource="members" action="invite">
          <Card>
            <CardHeader>
              <CardTitle>{t("invite")}</CardTitle>
            </CardHeader>
            <CardContent>
              <InviteForm />
            </CardContent>
          </Card>
        </PermissionGate>

        <PendingInvitesList />
      </div>
    </div>
  );
}
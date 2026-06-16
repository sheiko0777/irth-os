import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { getTranslations } from "next-intl/server";
import { InviteForm } from "./InviteForm";
import { MemberRoleSelect } from "./MemberRoleSelect";
import { PermissionGate } from "@/components/PermissionGate";
import { serverCaller } from "@/server/caller";

export default async function MembersPage() {
  const t = await getTranslations("settings");

  const caller = await serverCaller();
  const res = await caller.members.list();
  const members = res.data;
  const orgId = res.meta.orgId;

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">{t("members")}</h1>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>الأعضاء الحاليين</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {members.map((member) => (
                <div key={member.id} className="flex justify-between items-center border-b pb-2">
                  <span>{member.userId}</span>
                  <MemberRoleSelect memberId={member.id} role={member.role} />
                </div>
              ))}
              {members.length === 0 && (
                <p className="text-sm text-[var(--t3)]">لا يوجد أعضاء بعد</p>
              )}
            </div>
          </CardContent>
        </Card>

        <PermissionGate resource="members" action="invite">
          <Card>
            <CardHeader>
              <CardTitle>{t("invite")}</CardTitle>
            </CardHeader>
            <CardContent>
              <InviteForm orgId={orgId} />
            </CardContent>
          </Card>
        </PermissionGate>
      </div>
    </div>
  );
}

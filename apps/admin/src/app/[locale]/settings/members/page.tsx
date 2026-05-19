import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { getTranslations } from "next-intl/server";
import { InviteForm } from "./InviteForm";

export default async function MembersPage() {
  const t = await getTranslations("settings");

  const members = [
    { id: "1", userId: "user-1", role: "owner" },
    { id: "2", userId: "user-2", role: "member" },
  ];

  const orgId = "00000000-0000-0000-0000-000000000000";

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
                  <span className="text-sm text-muted-foreground">{member.role}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("invite")}</CardTitle>
          </CardHeader>
          <CardContent>
            <InviteForm orgId={orgId} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

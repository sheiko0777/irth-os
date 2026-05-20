import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { getTranslations } from "next-intl/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
// No explicit React import!

export default async function SettingsPage() {
  const t = await getTranslations("settings");

  // In a real app we would get the current user's org info
  // For the purpose of the task, let's mock it or display a placeholder
  const orgName = "IRTH Platform";
  const orgSlug = "irth-platform";

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>
      <Card>
        <CardHeader>
          <CardTitle>Organization Info</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Name</p>
              <p className="text-lg">{orgName}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Slug</p>
              <p className="text-lg">{orgSlug}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

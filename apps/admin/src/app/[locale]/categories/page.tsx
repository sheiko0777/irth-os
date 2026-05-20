import { getTranslations } from "next-intl/server";
import { serverCaller } from "@/server/caller";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";

export default async function CategoriesPage() {
  const t = await getTranslations("categories");
  const caller = await serverCaller();

  const categoriesResponse = await caller.categories.list();

  if (categoriesResponse.error) {
    return <div>Error loading categories</div>;
  }

  const { data: categories } = categoriesResponse;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>
        <PermissionGate resource="categories" action="write">
          <Button>{t("create")}</Button>
        </PermissionGate>
      </div>

      <div className="rounded-md border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("table.name")}</TableHead>
              <TableHead>{t("table.slug")}</TableHead>
              <TableHead className="text-end">{t("table.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center">
                  لا توجد تصنيفات.
                </TableCell>
              </TableRow>
            ) : (
              categories.map(
                (category: { id: string; name: string; slug: string }) => (
                  <TableRow key={category.id}>
                    <TableCell className="font-medium">
                      {category.name}
                    </TableCell>
                    <TableCell>{category.slug}</TableCell>
                    <TableCell className="text-end">
                      <PermissionGate resource="categories" action="delete">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-500"
                        >
                          {t("delete")}
                        </Button>
                      </PermissionGate>
                    </TableCell>
                  </TableRow>
                ),
              )
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

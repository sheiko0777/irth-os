import { getTranslations } from "next-intl/server";
import { serverCaller } from "@/server/caller";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { verifySession } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function ProductsPage({ params, searchParams }: { params: { locale: string }, searchParams: { [key: string]: string | string[] | undefined } }) {
    const { locale } = await params;
    const session = await verifySession();
    if (!session) redirect(`/${locale}/login`);

    const t = await getTranslations("products");
    const caller = await serverCaller();

    const page = typeof searchParams.page === "string" ? parseInt(searchParams.page, 10) : 1;

    let productsResponse;
    try {
        productsResponse = await caller.products.list({ page, pageSize: 20 });
    } catch (e) {
        return <div>Error loading products</div>;
    }

    if (productsResponse.error) {
        return <div>Error loading products</div>;
    }

    const { data: products } = productsResponse;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>
                <Link href="/ar/products/new">
                    <Button>{t("create")}</Button>
                </Link>
            </div>

            <div className="rounded-md border bg-white">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>{t("table.name")}</TableHead>
                            <TableHead>القسم</TableHead>
                            <TableHead>{t("table.brand")}</TableHead>
                            <TableHead>{t("table.variants")}</TableHead>
                            <TableHead>{t("table.status")}</TableHead>
                            <TableHead className="text-end">{t("table.actions")}</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {products.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={6} className="text-center">لا توجد منتجات.</TableCell>
                            </TableRow>
                        ) : (
                            products.map((product) => (
                                <TableRow key={product.id}>
                                    <TableCell className="font-medium">{product.nameAr}</TableCell>
                                    <TableCell>{product.category}</TableCell>
                                    <TableCell>{product.brand}</TableCell>
                                    <TableCell>{product.variantsCount}</TableCell>
                                    <TableCell>
                                        <Badge variant={product.isActive ? "default" : "secondary"}>
                                            {product.isActive ? t("status.active") : t("status.inactive")}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-end">
                                        <Link href={`/ar/products/${product.id}`}>
                                            <Button variant="ghost" size="sm" className="ml-2">
                                                عرض
                                            </Button>
                                        </Link>
                                        <Link href={`/ar/products/${product.id}/edit`}>
                                            <Button variant="outline" size="sm">
                                                تعديل
                                            </Button>
                                        </Link>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}

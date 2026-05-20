import { getTranslations } from "next-intl/server";
import { serverCaller } from "@/server/caller";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { verifySession } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default async function ProductDetailPage({ params }: { params: { id: string, locale: string } }) {
    const { id, locale } = await params;
    const session = await verifySession();
    if (!session) redirect(`/${locale}/login`);

    const t = await getTranslations("products");
    const caller = await serverCaller();

    let response;
    try {
        response = await caller.products.getById({ id });
    } catch (e) {
        return <div>Product not found</div>;
    }

    if (response?.error || !response?.data) {
        return <div>Product not found</div>;
    }

    const { product, variants } = response.data;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold tracking-tight">
                    {product.nameAr} <span className="text-muted-foreground text-xl">({product.nameEn})</span>
                </h1>
                <Link href={`/ar/products/${product.id}/edit`}>
                    <Button>تعديل</Button>
                </Link>
            </div>

            <div className="grid gap-6 md:grid-cols-3">
                <Card className="md:col-span-1">
                    <CardHeader>
                        <CardTitle>تفاصيل المنتج</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div>
                            <p className="text-sm text-muted-foreground">القسم</p>
                            <p className="font-medium">{product.category}</p>
                        </div>
                        <div>
                            <p className="text-sm text-muted-foreground">العلامة التجارية</p>
                            <p className="font-medium">{product.brand}</p>
                        </div>
                        <div>
                            <p className="text-sm text-muted-foreground">الحالة</p>
                            <Badge variant={product.isActive ? "default" : "secondary"}>
                                {product.isActive ? t("status.active") : t("status.inactive")}
                            </Badge>
                        </div>
                        <div>
                            <p className="text-sm text-muted-foreground">الوصف</p>
                            <p className="text-sm">{product.description || "لا يوجد وصف"}</p>
                        </div>
                    </CardContent>
                </Card>

                <Card className="md:col-span-2">
                    <CardHeader>
                        <CardTitle>{t("form.variants")}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>SKU</TableHead>
                                    <TableHead>السعر</TableHead>
                                    <TableHead className="text-end">المخزون</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {variants.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={3} className="text-center">لا توجد أنواع</TableCell>
                                    </TableRow>
                                ) : (
                                    variants.map((variant) => (
                                        <TableRow key={variant.id}>
                                            <TableCell>{variant.sku}</TableCell>
                                            <TableCell>{variant.price} ج.م</TableCell>
                                            <TableCell className="text-end">{variant.stock}</TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

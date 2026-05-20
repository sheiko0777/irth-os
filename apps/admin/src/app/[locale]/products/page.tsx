import { getTranslations } from "next-intl/server";
import { serverCaller } from "@/server/caller";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { redirect } from "next/navigation";

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
    const searchParamsResolved = await searchParams;
    const t = await getTranslations("products");
    const caller = await serverCaller();

    const page = typeof searchParamsResolved.page === "string" ? parseInt(searchParamsResolved.page, 10) : 1;
    const q = typeof searchParamsResolved.q === "string" ? searchParamsResolved.q : undefined;
    const status = typeof searchParamsResolved.status === "string" ? searchParamsResolved.status : undefined;

    const productsResponse = await caller.products.list({ page, pageSize: 20, q, status });

    if (productsResponse.error) {
        return <div>Error loading products</div>;
    }

    const { data: products } = productsResponse;

    async function handleSearch(formData: FormData) {
        'use server'
        const q = formData.get('q')?.toString() || '';
        const status = formData.get('status')?.toString() || '';
        const params = new URLSearchParams();
        if (q) params.set('q', q);
        if (status && status !== 'all') params.set('status', status);
        redirect(`?${params.toString()}`);
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>
                <Link href="/ar/products/new">
                    <Button>{t("create")}</Button>
                </Link>
            </div>

            <form action={handleSearch} className="flex gap-4">
                <Input name="q" placeholder={t("search")} defaultValue={q} className="max-w-xs" />
                <Select name="status" defaultValue={status || 'all'}>
                    <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder={t("statusFilter")} />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">{t("allStatuses")}</SelectItem>
                        <SelectItem value="active">{t("status.active")}</SelectItem>
                        <SelectItem value="draft">{t("status.draft")}</SelectItem>
                        <SelectItem value="archived">{t("status.archived")}</SelectItem>
                    </SelectContent>
                </Select>
                <Button type="submit">بحث</Button>
            </form>

            <div className="rounded-md border bg-white">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>{t("table.name")}</TableHead>
                            <TableHead>{t("table.sku")}</TableHead>
                            <TableHead>{t("table.price")}</TableHead>
                            <TableHead>{t("table.stock")}</TableHead>
                            <TableHead>{t("table.category")}</TableHead>
                            <TableHead>{t("table.status")}</TableHead>
                            <TableHead className="text-end">{t("table.actions")}</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {products.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={7} className="text-center">لا توجد منتجات.</TableCell>
                            </TableRow>
                        ) : (
                            products.map((product: any) => (
                                <TableRow key={product.id}>
                                    <TableCell className="font-medium">{product.name}</TableCell>
                                    <TableCell>{product.sku}</TableCell>
                                    <TableCell>{product.price}</TableCell>
                                    <TableCell>{product.stock}</TableCell>
                                    <TableCell>{product.category || '-'}</TableCell>
                                    <TableCell>
                                        <Badge variant={product.status === 'active' ? "default" : "secondary"}>
                                            {product.status === 'active' ? t("status.active") : product.status === 'draft' ? t("status.draft") : t("status.archived")}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-end">
                                        <Link href={`/ar/products/${product.id}/edit`}>
                                            <Button variant="ghost" size="sm">
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

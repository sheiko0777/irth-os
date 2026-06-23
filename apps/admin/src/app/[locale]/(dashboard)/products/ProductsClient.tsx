'use client';

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PermissionGate } from "@/components/PermissionGate";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Pagination } from "@/components/ui/Pagination";
import { SkeletonRow } from "@/components/ui/skeleton";
import { toast } from "sonner";

export interface Product {
    id: string;
    name: string;
    sku: string;
    price: string;
    stock: number;
    status: string;
    category: string | null;
    brand: "irth";
}

export interface Category {
    id: string;
    name: string;
    slug: string;
    parentId: string | null;
}

export function ProductsClient({ products: initialProducts, categories }: { products: Product[], categories: Category[] }) {
    const [searchQuery, setSearchQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState("all");
    const [page, setPage] = useState(1);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const PAGE_SIZE = 50;
    
    // Modal state for form
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formName, setFormName] = useState("");
    const [formNameAr, setFormNameAr] = useState("");
    const [formSku, setFormSku] = useState("");
    const [formPrice, setFormPrice] = useState("");
    const [formStatus, setFormStatus] = useState("active");
    const [formCategoryId, setFormCategoryId] = useState("");

    const utils = trpc.useUtils();

    // Queries
    const { data: productsData, isFetching } = trpc.products.list.useQuery(
        { page, pageSize: PAGE_SIZE, q: searchQuery, status: statusFilter === "all" ? undefined : statusFilter },
        { initialData: { data: initialProducts, meta: { total: initialProducts.length, page: 1, pageSize: PAGE_SIZE }, error: null } }
    );

    const products = productsData?.data || initialProducts;
    const total = productsData?.meta?.total ?? products.length;

    // Mutations
    const createMutation = trpc.products.create.useMutation({
        onSuccess: () => {
            toast.success("تم إنشاء المنتج بنجاح");
            utils.products.list.invalidate();
            setIsModalOpen(false);
            resetForm();
        },
        onError: (err: unknown) => {
            toast.error(err instanceof Error ? err.message : "حدث خطأ أثناء إنشاء المنتج");
        }
    });

    const updateMutation = trpc.products.update.useMutation({
        onSuccess: () => {
            toast.success("تم تحديث المنتج بنجاح");
            utils.products.list.invalidate();
            setIsModalOpen(false);
            resetForm();
        },
        onError: (err: unknown) => {
            toast.error(err instanceof Error ? err.message : "حدث خطأ أثناء تحديث المنتج");
        }
    });

    const deactivateMutation = trpc.products.deactivate.useMutation({
        onSuccess: () => {
            toast.success("تم تعطيل المنتج");
            utils.products.list.invalidate();
        },
        onError: (err: unknown) => {
            toast.error(err instanceof Error ? err.message : "حدث خطأ أثناء التعطيل");
        }
    });

    const resetForm = () => {
        setEditingId(null);
        setFormName("");
        setFormNameAr("");
        setFormSku("");
        setFormPrice("");
        setFormStatus("active");
        setFormCategoryId("");
    };

    const handleOpenEdit = (p: Product) => {
        setEditingId(p.id);
        setFormName(p.name);
        setFormNameAr(""); // Using nameAr would be fetched if available in list payload, but it isn't returned by list. Just keep empty if unavailable.
        setFormSku(p.sku);
        setFormPrice(p.price.toString());
        setFormStatus(p.status);
        
        // Find category ID from category name
        const cat = categories.find(c => c.name === p.category);
        setFormCategoryId(cat ? cat.id : "");
        
        setIsModalOpen(true);
    };

    const handleSave = () => {
        if (editingId) {
            updateMutation.mutate({
                id: editingId,
                name: formName,
                nameAr: formNameAr || undefined,
                sku: formSku,
                price: parseFloat(formPrice) || 0,
                status: formStatus,
                categoryId: formCategoryId || undefined
            });
        } else {
            createMutation.mutate({
                name: formName,
                nameAr: formNameAr || undefined,
                sku: formSku,
                price: parseFloat(formPrice) || 0,
                status: formStatus,
                categoryId: formCategoryId || undefined,
                stock: 0,
            });
        }
    };

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'active':
                return <Badge style={{ backgroundColor: 'var(--emerald)' }}>نشط</Badge>;
            case 'draft':
                return <Badge style={{ backgroundColor: 'var(--gold)' }}>مسودة</Badge>;
            case 'archived':
                return <Badge style={{ backgroundColor: 'var(--rim1)' }}>مؤرشف</Badge>;
            default:
                return <Badge variant="outline">{status}</Badge>;
        }
    };

    return (
        <div dir="rtl" className="font-cairo space-y-6" style={{ backgroundColor: 'var(--surface)' }}>
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold tracking-tight" style={{ color: 'var(--t1)' }}>إدارة المنتجات</h1>
                <PermissionGate resource="products" action="write">
                    <Dialog open={isModalOpen} onOpenChange={(open) => {
                        setIsModalOpen(open);
                        if (!open) resetForm();
                    }}>
                        <DialogTrigger asChild>
                            <Button style={{ backgroundColor: 'var(--t1)', color: 'var(--surface)' }}>منتج جديد</Button>
                        </DialogTrigger>
                        <DialogContent dir="rtl" className="font-cairo">
                            <DialogHeader>
                                <DialogTitle>{editingId ? "تعديل منتج" : "منتج جديد"}</DialogTitle>
                            </DialogHeader>
                            <div className="space-y-4 py-4">
                                <div className="space-y-2">
                                    <Label>الاسم</Label>
                                    <Input value={formName} onChange={(e: { target: { value: string } }) => setFormName(e.target.value)} />
                                </div>
                                <div className="space-y-2">
                                    <Label>الاسم (بالعربية)</Label>
                                    <Input value={formNameAr} onChange={(e: { target: { value: string } }) => setFormNameAr(e.target.value)} />
                                </div>
                                <div className="space-y-2">
                                    <Label>SKU</Label>
                                    <Input value={formSku} onChange={(e: { target: { value: string } }) => setFormSku(e.target.value)} />
                                </div>
                                <div className="space-y-2">
                                    <Label>السعر</Label>
                                    <Input type="number" step="0.01" value={formPrice} onChange={(e: { target: { value: string } }) => setFormPrice(e.target.value)} />
                                </div>
                                <div className="space-y-2">
                                    <Label>الحالة</Label>
                                    <Select value={formStatus} onValueChange={setFormStatus}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent dir="rtl">
                                            <SelectItem value="active">نشط</SelectItem>
                                            <SelectItem value="draft">مسودة</SelectItem>
                                            <SelectItem value="archived">مؤرشف</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>القسم</Label>
                                    <Select value={formCategoryId} onValueChange={setFormCategoryId}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="اختر القسم" />
                                        </SelectTrigger>
                                        <SelectContent dir="rtl">
                                            <SelectItem value="">لا يوجد قسم</SelectItem>
                                            {categories.map(c => (
                                                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <Button onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending} className="w-full">
                                    حفظ
                                </Button>
                            </div>
                        </DialogContent>
                    </Dialog>
                </PermissionGate>
            </div>

            <div className="flex gap-4 mb-4">
                <Input 
                    placeholder="بحث في المنتجات..." 
                    value={searchQuery}
                    onChange={(e: { target: { value: string } }) => setSearchQuery(e.target.value)}
                    className="max-w-xs"
                />
                <div className="flex gap-2 bg-[var(--surface)] p-1 rounded border">
                    <Button 
                        variant={statusFilter === "all" ? "default" : "ghost"} 
                        size="sm" 
                        onClick={() => setStatusFilter("all")}
                    >الكل</Button>
                    <Button 
                        variant={statusFilter === "active" ? "default" : "ghost"} 
                        size="sm" 
                        onClick={() => setStatusFilter("active")}
                    >نشط</Button>
                    <Button 
                        variant={statusFilter === "draft" ? "default" : "ghost"} 
                        size="sm" 
                        onClick={() => setStatusFilter("draft")}
                    >مسودة</Button>
                    <Button 
                        variant={statusFilter === "archived" ? "default" : "ghost"} 
                        size="sm" 
                        onClick={() => setStatusFilter("archived")}
                    >مؤرشف</Button>
                </div>
            </div>

            <div className="rounded-md border border-[var(--rim1)] bg-[var(--card-bg)]">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="text-right">الاسم</TableHead>
                            <TableHead className="text-right">SKU</TableHead>
                            <TableHead className="text-right">السعر</TableHead>
                            <TableHead className="text-right">المخزون</TableHead>
                            <TableHead className="text-right">الحالة</TableHead>
                            <TableHead className="text-right">القسم</TableHead>
                            <TableHead className="text-left">الإجراءات</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isFetching && products.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={7} className="py-2">
                                    <div className="space-y-1">
                                        <SkeletonRow />
                                        <SkeletonRow />
                                        <SkeletonRow />
                                        <SkeletonRow />
                                        <SkeletonRow />
                                    </div>
                                </TableCell>
                            </TableRow>
                        ) : products.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={7} className="text-center py-8" style={{ color: 'var(--t2)' }}>
                                    لا توجد منتجات
                                </TableCell>
                            </TableRow>
                        ) : (
                            products.map((p) => (
                                <TableRow key={p.id}>
                                    <TableCell className="font-medium">{p.name}</TableCell>
                                    <TableCell>{p.sku}</TableCell>
                                    <TableCell>{p.price}</TableCell>
                                    <TableCell>{p.stock}</TableCell>
                                    <TableCell>{getStatusBadge(p.status)}</TableCell>
                                    <TableCell>{p.category || '-'}</TableCell>
                                    <TableCell className="text-left">
                                        <PermissionGate resource="products" action="write">
                                            <div className="flex justify-end gap-2">
                                                <Button variant="ghost" size="sm" onClick={() => handleOpenEdit(p)}>
                                                    تعديل
                                                </Button>
                                                {p.status === 'active' && (
                                                    <ConfirmDialog
                                                        title="تعطيل المنتج"
                                                        description={`سيتم تعطيل المنتج «${p.name}». لن يظهر للبيع بعد ذلك.`}
                                                        confirmLabel="تعطيل"
                                                        pending={deactivateMutation.isPending}
                                                        onConfirm={() => deactivateMutation.mutate({ id: p.id })}
                                                    >
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            style={{ color: 'var(--crimson)' }}
                                                            disabled={deactivateMutation.isPending}
                                                        >
                                                            تعطيل
                                                        </Button>
                                                    </ConfirmDialog>
                                                )}
                                            </div>
                                        </PermissionGate>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>

            <Pagination
                page={page}
                pageSize={PAGE_SIZE}
                total={total}
                onPageChange={setPage}
            />
        </div>
    );
}

"use client";
import { currency, formatMoney, fromMinor } from '@irth/domain';

import { useState } from "react";

import { trpc } from "@/lib/trpc";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { Badge } from "@/components/ui/badge";

import { Button } from "@/components/ui/button";

import { Input } from "@/components/ui/input";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

import { format } from "date-fns";

import { ar } from "date-fns/locale";

import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from '@/components/ui/EmptyState';
import { ShoppingBag } from 'lucide-react';
import { Factory } from 'lucide-react';


type Supplier = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  createdAt: Date | string | null;
};

type PurchaseOrder = {
  id: string;
  poNumber: string;
  supplierName: string | null;
  status: string;
  totalAmountMinor: bigint | null;
  currency: string;
  createdAt: Date | string | null;
};

type Props = {
  suppliers: Supplier[];
  purchaseOrders: PurchaseOrder[];
  locale: string;
};

export function PurchasingClient({ suppliers, purchaseOrders, locale }: Props) {
  const [activeTab, setActiveTab] = useState<"suppliers" | "po">("suppliers");
  const utils = trpc.useUtils();

  // Dialog states
  const [isSupplierOpen, setIsSupplierOpen] = useState(false);
  const [isPoOpen, setIsPoOpen] = useState(false);

  // Supplier Form State
  const [supplierForm, setSupplierForm] = useState({ name: "", email: "", phone: "", address: "" });
  const createSupplier = trpc.purchasing.suppliers.create.useMutation({
    onSuccess: () => {
      toast.success("تم إضافة المورد بنجاح");
      utils.purchasing.suppliers.list.invalidate();
      setIsSupplierOpen(false);
      setSupplierForm({ name: "", email: "", phone: "", address: "" });
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "حدث خطأ أثناء إضافة المورد");
    },
  });
  const deleteSupplier = trpc.purchasing.suppliers.delete.useMutation({
    onSuccess: () => {
      toast.success("تم حذف المورد");
      utils.purchasing.suppliers.list.invalidate();
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "حدث خطأ أثناء الحذف");
    },
  });

  // PO Form State
  const [poForm, setPoForm] = useState({ supplierId: "", notes: "", items: [{ productName: "عنصر", quantity: 1 }] });
  const createPo = trpc.purchasing.po.create.useMutation({
    onSuccess: () => {
      utils.purchasing.po.list.invalidate();
      setIsPoOpen(false);
      setPoForm({ supplierId: "", notes: "", items: [{ productName: "عنصر", quantity: 1 }] });
    },
  });
  const updatePoStatus = trpc.purchasing.po.updateStatus.useMutation({
    onSuccess: () => utils.purchasing.po.list.invalidate(),
  });

  const getStatusColor = (status: string): "default" | "secondary" | "destructive" | "outline" => {
    switch (status) {
      case "draft": return "outline";
      case "ordered": return "secondary";
      case "received": return "default";
      case "cancelled": return "destructive";
      default: return "outline";
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "draft": return "مسودة";
      case "ordered": return "مطلوب";
      case "received": return "مستلم";
      case "cancelled": return "ملغي";
      default: return status;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight text-[var(--t1)]">المشتريات</h1>
      </div>

      <div className="flex gap-2 border-b border-[var(--rim1)] pb-2">
        <Button
          variant={activeTab === "suppliers" ? "default" : "outline"}
          onClick={() => setActiveTab("suppliers")}
        >
          الموردون
        </Button>
        <Button
          variant={activeTab === "po" ? "default" : "outline"}
          onClick={() => setActiveTab("po")}
        >
          طلبات الشراء
        </Button>
      </div>

      {activeTab === "suppliers" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Dialog open={isSupplierOpen} onOpenChange={setIsSupplierOpen}>
              <DialogTrigger asChild>
                <Button>إضافة مورد</Button>
              </DialogTrigger>
              <DialogContent className="z-50 bg-[var(--surface)] text-[var(--t1)]">
                <DialogHeader>
                  <DialogTitle>إضافة مورد جديد</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-4">
                  <div>
                    <label className="text-sm">الاسم</label>
                    <Input
                      value={supplierForm.name}
                      onChange={(e: { target: { value: string } }) => setSupplierForm({ ...supplierForm, name: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-sm">الهاتف</label>
                    <Input
                      value={supplierForm.phone}
                      onChange={(e: { target: { value: string } }) => setSupplierForm({ ...supplierForm, phone: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-sm">البريد الإلكتروني</label>
                    <Input
                      value={supplierForm.email}
                      onChange={(e: { target: { value: string } }) => setSupplierForm({ ...supplierForm, email: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-sm">العنوان</label>
                    <Input
                      value={supplierForm.address}
                      onChange={(e: { target: { value: string } }) => setSupplierForm({ ...supplierForm, address: e.target.value })}
                    />
                  </div>
                  <Button
                    className="w-full"
                    onClick={() => createSupplier.mutate(supplierForm)}
                    disabled={createSupplier.isPending}
                  >
                    حفظ
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <div className="rounded-md border border-[var(--rim1)] bg-[var(--surface)]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">الاسم</TableHead>
                  <TableHead className="text-right">الهاتف</TableHead>
                  <TableHead className="text-right">البريد الإلكتروني</TableHead>
                  <TableHead className="text-right">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {suppliers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="p-0">
                      <EmptyState
                        icon={Factory}
                        title="لا يوجد موردون"
                        hint="ضيف مورد الأول عشان تقدر تعمل أمر شراء."
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  suppliers.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="text-[var(--t1)]">{s.name}</TableCell>
                      <TableCell className="text-[var(--t2)]" dir="ltr">{s.phone || "-"}</TableCell>
                      <TableCell className="text-[var(--t2)]" dir="ltr">{s.email || "-"}</TableCell>
                      <TableCell>
                        <ConfirmDialog
                          title="حذف المورد"
                          description={`هل أنت متأكد من حذف المورد «${s.name}»؟`}
                          confirmLabel="حذف"
                          pending={deleteSupplier.isPending}
                          onConfirm={() => deleteSupplier.mutate({ id: s.id })}
                        >
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={deleteSupplier.isPending}
                          >
                            حذف
                          </Button>
                        </ConfirmDialog>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {activeTab === "po" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Dialog open={isPoOpen} onOpenChange={setIsPoOpen}>
              <DialogTrigger asChild>
                <Button>طلب جديد</Button>
              </DialogTrigger>
              <DialogContent className="z-50 bg-[var(--surface)] text-[var(--t1)]">
                <DialogHeader>
                  <DialogTitle>طلب شراء جديد</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-4">
                  <div>
                    <label className="text-sm">المورد</label>
                    <select
                      className="w-full rounded-md border border-[var(--rim1)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--t1)]"
                      value={poForm.supplierId}
                      onChange={(e: { target: { value: string } }) => setPoForm({ ...poForm, supplierId: e.target.value })}
                    >
                      <option value="">اختر المورد...</option>
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-sm">ملاحظات</label>
                    <Input
                      value={poForm.notes}
                      onChange={(e: { target: { value: string } }) => setPoForm({ ...poForm, notes: e.target.value })}
                    />
                  </div>
                  <Button
                    className="w-full"
                    onClick={() => createPo.mutate({
                      supplierId: poForm.supplierId || undefined,
                      notes: poForm.notes,
                      items: poForm.items
                    })}
                    disabled={createPo.isPending}
                  >
                    إنشاء
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <div className="rounded-md border border-[var(--rim1)] bg-[var(--surface)]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">رقم الأمر</TableHead>
                  <TableHead className="text-right">المورد</TableHead>
                  <TableHead className="text-right">الحالة</TableHead>
                  <TableHead className="text-right">الإجمالي</TableHead>
                  <TableHead className="text-right">التاريخ</TableHead>
                  <TableHead className="text-right">الإجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {purchaseOrders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="p-0">
                      <EmptyState icon={ShoppingBag} title="لا توجد أوامر شراء" hint="أمر الشراء بيسجّل الكميات المستلمة من المورد ويزوّد المخزون." />
                    </TableCell>
                  </TableRow>
                ) : (
                  purchaseOrders.map((po) => (
                    <TableRow key={po.id}>
                      <TableCell className="font-medium text-[var(--t1)]">{po.poNumber}</TableCell>
                      <TableCell className="text-[var(--t2)]">{po.supplierName || "غير محدد"}</TableCell>
                      <TableCell>
                        <Badge
                          variant={getStatusColor(po.status)}
                          className={
                            po.status === "ordered" ? "bg-[var(--gold)] text-void" :
                            po.status === "received" ? "bg-[var(--emerald)] text-void" :
                            po.status === "cancelled" ? "bg-[var(--crimson)] text-void" :
                            "bg-raised text-t1"
                          }
                        >
                          {getStatusLabel(po.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-[var(--t2)]">
                        {po.totalAmountMinor === null ? "-" : formatMoney(fromMinor(po.totalAmountMinor, currency(po.currency)))}
                      </TableCell>
                      <TableCell className="text-[var(--t2)]">
                        {po.createdAt ? format(new Date(po.createdAt), "PP", { locale: ar }) : "-"}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2 justify-end">
                          {po.status === "draft" && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => updatePoStatus.mutate({ id: po.id, status: "ordered" as const })}
                              disabled={updatePoStatus.isPending}
                            >
                              طلب
                            </Button>
                          )}
                          {(po.status === "ordered" || po.status === "partial") && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => updatePoStatus.mutate({ id: po.id, status: "received" as const })}
                              disabled={updatePoStatus.isPending}
                            >
                              استلام
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}
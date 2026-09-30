import { serverCaller } from "@/server/caller";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from '@/components/ui/EmptyState';
import { Factory, Truck } from 'lucide-react';
import { PageHeader } from "@/components/ui/PageHeader";

export default async function SuppliersPage() {
  const caller = await serverCaller();
  const response = await caller.purchasing.suppliers.list();

  if (response.error) {
    return <ErrorState message="تعذّر تحميل قائمة الموردين." />;
  }

  const suppliers = response.data;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="المخزون والمنتجات"
        title={"الموردين"}
        icon={<Truck />}
      />

      <div className="glass rounded-[var(--card-radius)]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الاسم</TableHead>
              <TableHead>البريد الإلكتروني</TableHead>
              <TableHead>رقم الهاتف</TableHead>
              <TableHead>العنوان</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {suppliers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="p-0">
                  <EmptyState
                    icon={Factory}
                    title="لا يوجد موردون"
                    hint="المورد بيتربط بأوامر الشراء، وبيحدّد مصدر كل صنف بيدخل المخزون."
                  />
                </TableCell>
              </TableRow>
            ) : (
              suppliers.map((supplier) => (
                <TableRow key={supplier.id}>
                  <TableCell className="font-medium">{supplier.name}</TableCell>
                  <TableCell className="text-left" dir="ltr">{supplier.email || '-'}</TableCell>
                  <TableCell className="text-left" dir="ltr">{supplier.phone || '-'}</TableCell>
                  <TableCell>{supplier.address || '-'}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
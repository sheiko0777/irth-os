import { serverCaller } from "@/server/caller";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { format } from "date-fns";
import { ar } from "date-fns/locale";
import PurchasingActions from "./PurchasingActions";

export default async function PurchasingPage() {
  const caller = await serverCaller();
  const response = await caller.purchasing.po.list({ page: 1, pageSize: 50 });

  if (response.error) {
    return <div>Error loading purchase orders</div>;
  }

  const pos = response.data;

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'draft': return 'outline';
      case 'ordered': return 'secondary'; // gold approximation
      case 'partial': return 'secondary';
      case 'received': return 'default'; // emerald approximation
      case 'cancelled': return 'destructive'; // crimson approximation
      default: return 'outline';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'draft': return 'مسودة';
      case 'ordered': return 'مطلوب';
      case 'partial': return 'مستلم جزئياً';
      case 'received': return 'مستلم';
      case 'cancelled': return 'ملغى';
      default: return status;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">أوامر الشراء</h1>
        <div className="flex gap-2">
          <Link href="/ar/purchasing/suppliers">
            <Button variant="outline">الموردين</Button>
          </Link>
          <PurchasingActions actionType="create" />
        </div>
      </div>

      <div className="rounded-md border bg-[var(--surface)]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>رقم الأمر</TableHead>
              <TableHead>المورد</TableHead>
              <TableHead>التاريخ</TableHead>
              <TableHead>القيمة</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead className="text-end">الإجراءات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pos.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center">لا توجد أوامر شراء.</TableCell>
              </TableRow>
            ) : (
              pos.map((po) => (
                <TableRow key={po.id}>
                  <TableCell className="font-medium">{po.poNumber}</TableCell>
                  <TableCell>{po.supplierName || 'غير محدد'}</TableCell>
                  <TableCell>{format(new Date(po.createdAt), 'PP', { locale: ar })}</TableCell>
                  <TableCell>{po.totalAmount ? `${po.totalAmount} ج.م` : '-'}</TableCell>
                  <TableCell>
                    <Badge variant={getStatusColor(po.status)}>{getStatusLabel(po.status)}</Badge>
                  </TableCell>
                  <TableCell className="text-end">
                    <div className="flex justify-end gap-2">
                      {po.status === 'draft' && (
                        <PurchasingActions actionType="updateStatus" poId={po.id} status="ordered" label="طلب" />
                      )}
                      {(po.status === 'ordered' || po.status === 'partial') && (
                        <PurchasingActions actionType="updateStatus" poId={po.id} status="received" label="استلام" />
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
  );
}

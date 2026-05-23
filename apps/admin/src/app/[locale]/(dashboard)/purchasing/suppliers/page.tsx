import { serverCaller } from "@/server/caller";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default async function SuppliersPage() {
  const caller = await serverCaller();
  const response = await caller.purchasing.suppliers.list();

  if (response.error) {
    return <div>Error loading suppliers</div>;
  }

  const suppliers = response.data;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">الموردين</h1>
      </div>

      <div className="rounded-md border bg-[var(--surface)]">
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
                <TableCell colSpan={4} className="text-center">لا يوجد موردين.</TableCell>
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

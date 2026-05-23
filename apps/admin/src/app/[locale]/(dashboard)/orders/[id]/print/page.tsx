import { serverCaller } from '@/server/caller';
import { notFound } from 'next/navigation';
import { PrintButton } from './PrintButton';

export default async function PrintPage({
    params,
}: {
    params: Promise<{ id: string; locale: string }>;
}) {
    const { id } = await params;
    const caller = await serverCaller();

    const response = await caller.orders.getById({ id });
    if (response.error || !response.data) notFound();

    const { order, items } = response.data;

    const total = Number(order.totalAmount).toLocaleString('ar-EG', {
        minimumFractionDigits: 2,
    });

    return (
        <>
            <style>{`
                @page { margin: 20mm; }
                body {
                    direction: rtl;
                    font-family: Cairo, sans-serif;
                    color: #1a1a1a;
                    margin: 0;
                }
                table { width: 100%; border-collapse: collapse; }
                th, td { border: 1px solid #ccc; padding: 8px 12px; text-align: right; }
                th { background: #f5f5f5; font-weight: 600; }
                .no-print { margin-top: 24px; }
                @media print { .no-print { display: none; } }
            `}</style>

            <div style={{ maxWidth: 800, margin: '0 auto', padding: '24px 16px' }}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
                    <div>
                        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>نظام إرث</h1>
                        <p style={{ color: '#666', margin: '4px 0 0' }}>فاتورة / إيصال</p>
                    </div>
                    <div style={{ textAlign: 'left' }}>
                        <p style={{ fontWeight: 600, margin: 0 }}>رقم الفاتورة: {order.orderNumber}</p>
                        <p style={{ color: '#666', margin: '4px 0 0' }}>
                            التاريخ:{' '}
                            {order.createdAt
                                ? new Date(order.createdAt).toLocaleDateString('ar-EG')
                                : '—'}
                        </p>
                    </div>
                </div>

                <hr style={{ borderColor: '#ddd', marginBottom: 24 }} />

                {/* Items table */}
                <table>
                    <thead>
                        <tr>
                            <th>المنتج</th>
                            <th style={{ width: 80 }}>الكمية</th>
                            <th style={{ width: 120 }}>سعر الوحدة</th>
                            <th style={{ width: 120 }}>الإجمالي</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.map((item) => {
                            const unitPrice = Number(item.price);
                            const lineTotal = unitPrice * item.quantity;
                            return (
                                <tr key={item.id}>
                                    <td>{item.sku}</td>
                                    <td>{item.quantity}</td>
                                    <td>
                                        {unitPrice.toLocaleString('ar-EG', {
                                            minimumFractionDigits: 2,
                                        })} ج.م
                                    </td>
                                    <td>
                                        {lineTotal.toLocaleString('ar-EG', {
                                            minimumFractionDigits: 2,
                                        })} ج.م
                                    </td>
                                </tr>
                            );
                        })}
                        <tr>
                            <td colSpan={3} style={{ fontWeight: 700, textAlign: 'right' }}>
                                الإجمالي
                            </td>
                            <td style={{ fontWeight: 700 }}>{total} ج.م</td>
                        </tr>
                    </tbody>
                </table>

                {/* Print button */}
                <div className="no-print" style={{ textAlign: 'center', marginTop: 32 }}>
                    <PrintButton />
                </div>
            </div>
        </>
    );
}

import { serverCaller } from '@/server/caller';
import EtaClient, { type EtaInvoice } from './EtaClient';

export const metadata = { title: 'فواتير ETA | IRTH' };

interface PageProps {
    params: Promise<{ locale: string }>;
}

export default async function EtaPage({ params }: PageProps) {
    const { locale: _locale } = await params;
    const caller = await serverCaller();
    const response = await caller.eta.list({});

    if (response.error) {
        return <div className="text-[var(--crimson)] p-4 font-cairo">خطأ في تحميل الفواتير الإلكترونية</div>;
    }

    const invoices: EtaInvoice[] = response.data.map((inv) => ({
        ...inv,
        createdAt: new Date(inv.createdAt as unknown as string | number),
        submittedAt: inv.submittedAt ? new Date(inv.submittedAt as unknown as string | number) : null,
    }));

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold font-cairo text-[var(--t1)]">الفواتير الإلكترونية (هيئة الزكاة)</h1>
            </div>

            <div className="bg-[var(--surface)] border border-[var(--rim1)] rounded-md p-4 text-sm font-cairo text-[var(--t2)]">
                <p>يتم تقديم الفواتير الإلكترونية تلقائياً لهيئة الزكاة والضريبة والجمارك (ETA) وفقاً للمتطلبات القانونية المصرية.</p>
            </div>

            <EtaClient invoices={invoices} />
        </div>
    );
}

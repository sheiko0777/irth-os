import { serverCaller } from '@/server/caller';
import EtaClient, { type EtaInvoice } from './EtaClient';
import { PageHeader } from "@/components/ui/PageHeader";
import { FileText } from "lucide-react";

export const metadata = { title: 'فواتير ETA | IRTH' };

interface PageProps {
    params: Promise<{ locale: string }>;
}

export default async function EtaPage({ params }: PageProps) {
    const { locale: _locale } = await params;
    const caller = await serverCaller();
    const response = await caller.eta.list({});

    if (response.error) {
        return <div className="text-[var(--crimson)] p-4">خطأ في تحميل الفواتير الإلكترونية</div>;
    }

    const invoices: EtaInvoice[] = response.data.map((inv) => ({
        ...inv,
        createdAt: new Date(inv.createdAt as unknown as string | number),
        submittedAt: inv.submittedAt ? new Date(inv.submittedAt as unknown as string | number) : null,
    }));

    return (
        <div className="space-y-6">
            <PageHeader
              eyebrow="العمليات"
              title={"الفواتير الإلكترونية (هيئة الزكاة)"}
              icon={<FileText />}
            />

            <div className="glass rounded-[var(--card-radius)] p-4 text-sm text-[var(--t2)]">
                <p>يتم تقديم الفواتير الإلكترونية تلقائياً لهيئة الزكاة والضريبة والجمارك (ETA) وفقاً للمتطلبات القانونية المصرية.</p>
            </div>

            <EtaClient invoices={invoices} />
        </div>
    );
}

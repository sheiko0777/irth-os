import { serverCaller } from '@/server/caller';
import PriceListsClient from './PriceListsClient';

export default async function PriceListsPage() {
    try {
        const caller = await serverCaller();
        const callerRecord = caller as unknown as Record<string, unknown>;
        const pricelistsRouter = callerRecord.pricelists as { list?: (args: unknown) => Promise<unknown[]> } | undefined;
        let data: unknown[] = [];
        if (pricelistsRouter && pricelistsRouter.list) {
            data = await pricelistsRouter.list({});
        }
        
        return <PriceListsClient initialData={data as unknown as import('./PriceListsClient').PriceList[]} />;
    } catch (error) {
        console.error('Failed to fetch pricelists:', error);
        return (
            <div className="p-6 text-center" style={{ color: 'var(--crimson)' }}>
                <p>حدث خطأ أثناء تحميل قوائم الأسعار. يرجى المحاولة مرة أخرى لاحقاً.</p>
            </div>
        );
    }
}

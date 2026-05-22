import { getTranslations } from "next-intl/server";
import { serverCaller } from "@/server/caller";
import { format } from "date-fns";
import { ar } from "date-fns/locale";
import { EtaActions } from "./EtaActions";

export default async function EtaPage() {
    const t = await getTranslations("eta");
    const caller = await serverCaller();

    const response = await caller.eta.list();

    if (response.error) {
        return <div>{t("error")}</div>;
    }

    const { data: invoices } = response;

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'valid':
                return <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">{t(`status.${status}`)}</span>;
            case 'submitted':
                return <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 ring-1 ring-inset ring-blue-700/10">{t(`status.${status}`)}</span>;
            case 'pending':
                return <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20">{t(`status.${status}`)}</span>;
            case 'rejected':
            case 'cancelled':
                return <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-1 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-600/10">{t(`status.${status}`)}</span>;
            default:
                return <span className="inline-flex items-center rounded-full bg-gray-50 px-2 py-1 text-xs font-medium text-gray-600 ring-1 ring-inset ring-gray-500/10">{status}</span>;
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-[var(--t1)]">{t("title")}</h1>
                    <p className="text-sm text-[var(--t2)] mt-2">{t("description")}</p>
                </div>
                <EtaActions />
            </div>

            <div className="rounded-md border border-[var(--rim1)] bg-[var(--surface)] overflow-hidden">
                <table className="min-w-full divide-y divide-[var(--rim1)]">
                    <thead className="bg-[var(--rim1)]/50">
                        <tr>
                            <th scope="col" className="px-6 py-3 text-right text-sm font-semibold text-[var(--t1)]">
                                {t("columns.orderId")}
                            </th>
                            <th scope="col" className="px-6 py-3 text-right text-sm font-semibold text-[var(--t1)]">
                                {t("columns.amount")}
                            </th>
                            <th scope="col" className="px-6 py-3 text-right text-sm font-semibold text-[var(--t1)]">
                                {t("columns.status")}
                            </th>
                            <th scope="col" className="px-6 py-3 text-right text-sm font-semibold text-[var(--t1)]">
                                {t("columns.uuid")}
                            </th>
                            <th scope="col" className="px-6 py-3 text-right text-sm font-semibold text-[var(--t1)]">
                                {t("columns.date")}
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--rim1)] bg-[var(--surface)]">
                        {invoices.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="px-6 py-8 text-center text-sm text-[var(--t2)]">
                                    {t("empty")}
                                </td>
                            </tr>
                        ) : (
                            invoices.map((invoice: { id: string; orderNumber: string; totalAmount: string | number; status: string; etaUuid: string | null; submittedAt: string | Date | null; errorMessage: string | null; }) => (
                                <tr key={invoice.id} className="hover:bg-[var(--rim1)]/20">
                                    <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-[var(--t1)]">
                                        #{invoice.orderNumber.substring(0, 8)}
                                    </td>
                                    <td className="whitespace-nowrap px-6 py-4 text-sm text-[var(--t2)]">
                                        {Number(invoice.totalAmount).toLocaleString('ar-EG', { style: 'currency', currency: 'EGP' })}
                                    </td>
                                    <td className="whitespace-nowrap px-6 py-4 text-sm text-[var(--t2)]">
                                        {getStatusBadge(invoice.status)}
                                    </td>
                                    <td className="whitespace-nowrap px-6 py-4 text-sm text-[var(--t2)] font-mono">
                                        {invoice.etaUuid ? invoice.etaUuid.substring(0, 8) + '...' : '-'}
                                    </td>
                                    <td className="whitespace-nowrap px-6 py-4 text-sm text-[var(--t2)]">
                                        {invoice.submittedAt ? format(new Date(invoice.submittedAt), 'PPp', { locale: ar }) : '-'}
                                        {invoice.errorMessage && (
                                            <p className="text-xs text-red-500 mt-1 max-w-[200px] truncate" title={invoice.errorMessage}>
                                                {invoice.errorMessage}
                                            </p>
                                        )}
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

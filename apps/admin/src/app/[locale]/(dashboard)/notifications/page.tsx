import { serverCaller } from '@/server/caller';
import { statusLabel } from '@/lib/statusMaps';

export default async function NotificationsPage() {
    const caller = await serverCaller();
    const response = await caller.notifications.list({ page: 1, pageSize: 50 });

    const items = response.error ? [] : response.data.items;

    return (
        <div className="font-cairo p-6 space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold text-[var(--t1)]">الإشعارات</h1>
                {response.data && (
                    <span className="text-sm text-[var(--t2)]">
                        {response.data.unread} غير مقروء
                    </span>
                )}
            </div>

            <div className="bg-[var(--surface)] rounded-md border border-[var(--rim1)] overflow-hidden">
                <table className="w-full text-right">
                    <thead className="bg-gray-50 border-b border-[var(--rim1)]">
                        <tr>
                            <th className="px-4 py-3 text-sm font-medium text-[var(--t2)]">النوع</th>
                            <th className="px-4 py-3 text-sm font-medium text-[var(--t2)]">العنوان</th>
                            <th className="px-4 py-3 text-sm font-medium text-[var(--t2)]">التفاصيل</th>
                            <th className="px-4 py-3 text-sm font-medium text-[var(--t2)]">الوقت</th>
                            <th className="px-4 py-3 text-sm font-medium text-[var(--t2)]">الحالة</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--rim1)]">
                        {items.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="px-4 py-8 text-center text-[var(--t2)]">
                                    لا توجد إشعارات
                                </td>
                            </tr>
                        ) : (
                            items.map((item) => (
                                <tr key={item.id} className="hover:bg-gray-50/50">
                                    <td className="px-4 py-3 text-sm text-[var(--t2)]">
                                        {statusLabel('notificationType', item.type)}
                                    </td>
                                    <td className="px-4 py-3 text-sm font-medium text-[var(--t1)]">
                                        {item.title}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-[var(--t2)] max-w-xs truncate">
                                        {item.body ?? 'ـ'}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-[var(--t2)]" dir="ltr">
                                        {item.createdAt
                                            ? new Date(item.createdAt).toLocaleString('ar-EG')
                                            : 'ـ'}
                                    </td>
                                    <td className="px-4 py-3 text-sm">
                                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                            item.read
                                                ? 'bg-gray-100 text-gray-600'
                                                : 'bg-amber-100 text-amber-800'
                                        }`}>
                                            {item.read ? 'مقروء' : 'جديد'}
                                        </span>
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
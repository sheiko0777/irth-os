'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { trpc } from '@/lib/trpc';

interface Props {
    open: boolean;
    onClose: () => void;
}

function relativeTime(date: Date | string | null): string {
    if (!date) return '';
    const diff = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
    if (diff < 60)    return 'منذ لحظات';
    if (diff < 3600)  return `منذ ${Math.floor(diff / 60)} دقيقة`;
    if (diff < 86400) return `منذ ${Math.floor(diff / 3600)} ساعة`;
    return `منذ ${Math.floor(diff / 86400)} يوم`;
}

export function NotificationPanel({ open, onClose }: Props) {
    const [readSet, setReadSet] = useState<Set<string>>(new Set());
    const utils = trpc.useUtils();

    const { data, isLoading } = trpc.notifications.list.useQuery(
        { page: 1, pageSize: 20 },
        { enabled: open }
    );

    const markRead = trpc.notifications.markRead.useMutation({
        onSuccess: () => utils.notifications.unreadCount.invalidate(),
    });

    const markAllRead = trpc.notifications.markAllRead.useMutation({
        onSuccess: () => {
            utils.notifications.list.invalidate();
            utils.notifications.unreadCount.invalidate();
        },
    });

    const items = data?.data?.items ?? [];
    const unread = data?.data?.unread ?? 0;

    const handleMarkRead = (id: string) => {
        if (!readSet.has(id)) {
            setReadSet((s) => new Set(s).add(id));
            markRead.mutate({ id });
        }
    };

    if (!open) return null;

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 z-40 bg-black/20"
                onClick={onClose}
                aria-hidden="true"
            />

            {/* Panel */}
            <div
                className="fixed top-0 left-0 h-full w-80 z-50 bg-[var(--surface)] border-r border-[var(--rim1)] shadow-xl flex flex-col"
            >
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--rim1)]">
                    <h2 className="text-base font-semibold text-[var(--t1)]">الإشعارات</h2>
                    <div className="flex items-center gap-2">
                        {unread > 0 && (
                            <button
                                onClick={() => markAllRead.mutate()}
                                disabled={markAllRead.isPending}
                                className="text-xs text-[var(--gold)] hover:underline cursor-pointer disabled:opacity-50"
                            >
                                قراءة الكل
                            </button>
                        )}
                        <button
                            onClick={onClose}
                            className="text-[var(--t2)] hover:text-[var(--t1)] cursor-pointer"
                            aria-label="إغلاق"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto divide-y divide-[var(--rim1)]">
                    {isLoading ? (
                        <div className="p-8 text-center text-sm text-[var(--t2)]">جارٍ التحميل…</div>
                    ) : items.length === 0 ? (
                        <div className="p-8 text-center text-sm text-[var(--t2)]">لا توجد إشعارات</div>
                    ) : (
                        items.map((item) => {
                            const isRead = item.read || readSet.has(item.id);
                            return (
                                <div
                                    key={item.id}
                                    onClick={() => handleMarkRead(item.id)}
                                    className={`px-4 py-3 cursor-pointer hover:bg-raised/50 transition-colors ${isRead ? 'opacity-60' : ''}`}
                                >
                                    <div className="flex items-start gap-2">
                                        <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${!isRead ? 'bg-[var(--gold)]' : ''}`} />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium text-[var(--t1)] truncate">
                                                {item.title}
                                            </p>
                                            {item.body && (
                                                <p className="text-xs text-[var(--t2)] mt-0.5 line-clamp-2">
                                                    {item.body.length > 80 ? item.body.slice(0, 80) + '…' : item.body}
                                                </p>
                                            )}
                                            <p className="text-xs text-[var(--t2)] mt-1">
                                                {relativeTime(item.createdAt)}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </>
    );
}

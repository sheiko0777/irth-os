'use client';

import { useState } from 'react';
import { Bell } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { NotificationPanel } from '@/components/NotificationPanel';

export function NotificationBell() {
    const [open, setOpen] = useState(false);

    const { data } = trpc.notifications.unreadCount.useQuery(undefined, {
        refetchInterval: 30_000,
    });

    const count = data?.data?.count ?? 0;

    return (
        <>
            <button
                onClick={() => setOpen(true)}
                className="relative p-2 rounded-md hover:bg-[var(--rim1)] text-[var(--t2)] hover:text-[var(--t1)] cursor-pointer transition-colors"
                aria-label="الإشعارات"
            >
                <Bell className="h-5 w-5" />
                {count > 0 && (
                    <span className="absolute top-1 start-1 h-4 w-4 rounded-full bg-[var(--crimson)] text-void text-[10px] font-bold flex items-center justify-center leading-none">
                        {count > 9 ? '9+' : count}
                    </span>
                )}
            </button>

            <NotificationPanel open={open} onClose={() => setOpen(false)} />
        </>
    );
}

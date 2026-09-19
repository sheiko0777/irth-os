'use client';

import { useState, useEffect } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { BarChart3, ShoppingCart, Users, Sparkles } from 'lucide-react';
import { CartMonitorClient } from './CartMonitorClient';

interface AnalyticsTabsProps {
  initialTab?: string;
  salesContent: React.ReactNode;
  sourcesContent: React.ReactNode;
}

export function AnalyticsTabs({ initialTab = 'sales', salesContent, sourcesContent }: AnalyticsTabsProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const currentTab = searchParams.get('tab') || initialTab;
  const [activeTab, setActiveTab] = useState<string>(currentTab);

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab && tab !== activeTab) {
      setActiveTab(tab);
    }
  }, [searchParams]);

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tabId);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="space-y-6">
      {/* Navigation Tabs Bar */}
      <div className="flex border-b border-[var(--rim1)] overflow-x-auto gap-1">
        <button
          type="button"
          onClick={() => handleTabChange('sales')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'sales'
              ? 'border-[var(--gold)] text-[var(--gold)] bg-[var(--gold)]/5'
              : 'border-transparent text-[var(--t2)] hover:text-[var(--t1)] hover:border-[var(--rim2)]'
          }`}
        >
          <BarChart3 className="w-4 h-4" />
          <span>المبيعات والإيرادات</span>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange('carts')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'carts'
              ? 'border-[var(--gold)] text-[var(--gold)] bg-[var(--gold)]/5'
              : 'border-transparent text-[var(--t2)] hover:text-[var(--t1)] hover:border-[var(--rim2)]'
          }`}
        >
          <ShoppingCart className="w-4 h-4" />
          <span>سلات الشراء وسلوك العملاء</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[var(--gold-bg)] border border-[var(--gold-br)] text-[var(--gold)]">
            مباشر
          </span>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange('sources')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'sources'
              ? 'border-[var(--gold)] text-[var(--gold)] bg-[var(--gold)]/5'
              : 'border-transparent text-[var(--t2)] hover:text-[var(--t1)] hover:border-[var(--rim2)]'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>مصادر الزيارات والصفحات</span>
        </button>
      </div>

      {/* Tab Panels */}
      {activeTab === 'sales' && salesContent}
      {activeTab === 'carts' && <CartMonitorClient />}
      {activeTab === 'sources' && sourcesContent}
    </div>
  );
}

'use client';

import { Button } from '@/components/ui/button';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';

const templates = [
  { name: 'المخازن', allow: ['inventory.view', 'inventory.write'], screens: ['inventory', 'stocktaking'] },
  { name: 'المشتريات', allow: ['purchasing.view', 'purchasing.write', 'products.view', 'inventory.view'], screens: ['purchasing', 'products', 'inventory'] },
  { name: 'العمليات', allow: ['orders.view', 'orders.write', 'returns.view', 'returns.write', 'customers.view'], screens: ['orders', 'returns', 'customers'] },
  { name: 'التسويق', allow: ['campaigns.view', 'campaigns.write', 'products.view', 'customers.view'], screens: ['campaigns', 'products', 'customers'] },
  { name: 'الحسابات', allow: ['finance.view', 'finance.write', 'courier.view', 'purchasing.view'], screens: ['finance', 'courier', 'purchasing'] },
] as const;

export function AccessProfileTemplates() {
  const utils = trpc.useUtils();
  const create = trpc.accessProfiles.create.useMutation({
    onSuccess: () => {
      toast.success('تم إنشاء قالب الصلاحيات');
      utils.accessProfiles.list.invalidate();
    },
    onError: (error) => toast.error(error.message || 'تعذر إنشاء القالب'),
  });

  return (
    <div className="flex flex-wrap gap-2">
      {templates.map((template) => (
        <Button key={template.name} variant="outline" size="sm" disabled={create.isPending} onClick={() => create.mutate({
          name: template.name,
          policy: { allow: [...template.allow], deny: [], screens: [...template.screens] },
        })}>
          إضافة قالب {template.name}
        </Button>
      ))}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { FormDialog } from '@/components/ui/FormDialog';

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function CreateZoneModal({ open, onClose, onSuccess }: Props) {
  const [zoneName, setZoneName] = useState('');
  const [zoneCountries, setZoneCountries] = useState('');

  const createZoneMutation = trpc.shipping.zones.create.useMutation({
    onSuccess: () => {
      setZoneName('');
      setZoneCountries('');
      onSuccess();
    },
  });

  const handleCreateZone = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    const countries = zoneCountries.split(',').map((c) => c.trim()).filter(Boolean);
    createZoneMutation.mutate({ name: zoneName, countries });
  };

  return (
    <FormDialog open={open} onClose={onClose} title="منطقة شحن جديدة">
      <form onSubmit={handleCreateZone} className="space-y-4">
        <div>
          <label className="block text-sm text-[var(--t2)] mb-1">اسم المنطقة</label>
          <input
            required
            value={zoneName}
            onChange={(e) => setZoneName(e.target.value)}
            className="w-full p-2 border rounded-md border-[var(--rim1)] bg-[var(--surface)] text-[var(--t1)]"
          />
        </div>
        <div>
          <label className="block text-sm text-[var(--t2)] mb-1">الدول (مفصولة بفاصلة)</label>
          <textarea
            value={zoneCountries}
            onChange={(e) => setZoneCountries(e.target.value)}
            rows={3}
            className="w-full p-2 border rounded-md border-[var(--rim1)] bg-[var(--surface)] text-[var(--t1)]"
          />
        </div>
        <div className="flex gap-2 justify-end">
          <Button type="button" variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button
            type="submit"
            disabled={createZoneMutation.isPending}
            style={{ background: 'var(--gold)', color: 'var(--void)' }}
          >
            {createZoneMutation.isPending ? '...' : 'إنشاء'}
          </Button>
        </div>
      </form>
    </FormDialog>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';

type MemberAccessEditorProps = {
  memberId: string;
  profileId: string | null;
  jobTitle: string | null;
  warehouseIds: string[];
};

export function MemberAccessEditor({ memberId, profileId, jobTitle, warehouseIds }: MemberAccessEditorProps) {
  const utils = trpc.useUtils();
  const profiles = trpc.accessProfiles.list.useQuery();
  const warehouses = trpc.warehouses.list.useQuery();
  const [selectedProfile, setSelectedProfile] = useState(profileId ?? '');
  const [title, setTitle] = useState(jobTitle ?? '');
  const [selectedWarehouses, setSelectedWarehouses] = useState<string[]>(warehouseIds);

  useEffect(() => {
    setSelectedProfile(profileId ?? '');
    setTitle(jobTitle ?? '');
    setSelectedWarehouses(warehouseIds);
  }, [profileId, jobTitle, warehouseIds]);

  const save = trpc.accessProfiles.assignMember.useMutation({
    onSuccess: () => {
      toast.success('تم حفظ صلاحيات الموظف');
      utils.members.list.invalidate();
      utils.me.get.invalidate();
    },
    onError: (error) => toast.error(error.message || 'تعذر حفظ الصلاحيات'),
  });

  const toggleWarehouse = (warehouseId: string) => {
    setSelectedWarehouses((current) => current.includes(warehouseId)
      ? current.filter((id) => id !== warehouseId)
      : [...current, warehouseId]);
  };

  return (
    <div className="mt-2 grid gap-2 border-t border-[var(--rim1)] pt-2 text-xs sm:grid-cols-[1fr_1fr_auto]">
      <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="المسمى الوظيفي" className="h-8 text-xs" />
      <select
        value={selectedProfile}
        onChange={(event) => setSelectedProfile(event.target.value)}
        className="h-8 rounded-md border border-[var(--rim1)] bg-[var(--surface)] px-2 text-xs text-[var(--t1)]"
      >
        <option value="">بدون قالب مخصص</option>
        {profiles.data?.data.map((profile) => <option value={profile.id} key={profile.id}>{profile.name}</option>)}
      </select>
      <Button type="button" size="sm" className="h-8 text-xs" disabled={save.isPending} onClick={() => save.mutate({
        memberId,
        profileId: selectedProfile || null,
        jobTitle: title.trim() || null,
        warehouseIds: selectedWarehouses,
        overrides: { allow: [], deny: [], screens: [] },
      })}>حفظ النطاق</Button>
      <div className="sm:col-span-3 flex flex-wrap gap-x-3 gap-y-1 text-[var(--t2)]">
        {warehouses.data?.data.map((warehouse) => (
          <label key={warehouse.id} className="flex items-center gap-1.5">
            <input type="checkbox" checked={selectedWarehouses.includes(warehouse.id)} onChange={() => toggleWarehouse(warehouse.id)} />
            {warehouse.name}
          </label>
        ))}
      </div>
    </div>
  );
}

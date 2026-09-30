'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { SegmentList } from './SegmentList';
import { SegmentMembersPanel } from './SegmentMembersPanel';
import { CreateSegmentModal } from './CreateSegmentModal';
import { useTranslations } from 'next-intl';
import { PageHeader } from "@/components/ui/PageHeader";
import { UsersRound } from "lucide-react";

export type CustomerSegment = {
  id: string;
  name: string;
  color: string;
  description: string | null;
  createdAt: string;
  memberCount: number;
};

export type SegmentMember = {
  memberId: string;
  customerId: string;
  addedAt: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
};

type Props = {
  initialSegments: CustomerSegment[];
};

export default function CustomerSegmentsClient({ initialSegments }: Props) {
  const t = useTranslations('customerSegments');
  const utils = trpc.useUtils();
  const [segments, setSegments] = useState<CustomerSegment[]>(initialSegments);
  const [showCreate, setShowCreate] = useState(false);
  const [activeSegment, setActiveSegment] = useState<CustomerSegment | null>(null);
  const [selectedToAdd, setSelectedToAdd] = useState<string[]>([]);
  const [showAddMembers, setShowAddMembers] = useState(false);
  const [createError, setCreateError] = useState('');

  const membersQuery = trpc.customerSegments.getMembers.useQuery(
    { segmentId: activeSegment?.id ?? '' },
    { enabled: !!activeSegment }
  );

  const availableQuery = trpc.customerSegments.getCustomersNotInSegment.useQuery(
    { segmentId: activeSegment?.id ?? '' },
    { enabled: showAddMembers && !!activeSegment }
  );

  // Derive lists from query data — local copies drift (they were never
  // populated on initial load, only after mutation refetches).
  const members = (membersQuery.data?.data ?? []) as unknown as SegmentMember[];
  const availableCustomers = availableQuery.data?.data ?? [];

  const createMutation = trpc.customerSegments.create.useMutation({
    onSuccess: (res) => {
      if (res.data) {
        setSegments((prev) => [{ ...res.data!, memberCount: 0 } as unknown as CustomerSegment, ...prev]);
        setShowCreate(false);
        setCreateError('');
      }
    },
    onError: (e) => setCreateError(e.message),
  });

  const deleteMutation = trpc.customerSegments.delete.useMutation({
    onSuccess: (_, vars) => {
      setSegments((prev) => prev.filter((s) => s.id !== vars.id));
      if (activeSegment?.id === vars.id) setActiveSegment(null);
    },
  });

  const addMembersMutation = trpc.customerSegments.addMembers.useMutation({
    onSuccess: (_, vars) => {
      setShowAddMembers(false);
      setSelectedToAdd([]);
      void utils.customerSegments.getMembers.invalidate({ segmentId: vars.segmentId });
      void utils.customerSegments.getCustomersNotInSegment.invalidate({ segmentId: vars.segmentId });
      setSegments((prev) => prev.map((s) => s.id === vars.segmentId ? { ...s, memberCount: s.memberCount + vars.customerIds.length } : s));
    },
  });

  const removeMemberMutation = trpc.customerSegments.removeMember.useMutation({
    onSuccess: () => {
      if (!activeSegment) return;
      void utils.customerSegments.getMembers.invalidate({ segmentId: activeSegment.id });
      void utils.customerSegments.getCustomersNotInSegment.invalidate({ segmentId: activeSegment.id });
      setSegments((prev) => prev.map((s) => s.id === activeSegment.id ? { ...s, memberCount: s.memberCount - 1 } : s));
    },
  });

  const handleCreate = (data: { name: string; color: string; description?: string }) => {
    if (!data.name.trim()) { setCreateError(t('validation.nameRequired')); return; }
    createMutation.mutate(data);
  };

  const handleOpenSegment = (seg: CustomerSegment) => {
    setActiveSegment(seg);
    setShowAddMembers(false);
    setSelectedToAdd([]);
  };

  const toggleSelect = (id: string) => {
    setSelectedToAdd((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="عام"
        title={t('title')}
        description={t('subtitle')}
        icon={<UsersRound />}
        actions={<><button
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--control-radius)] bg-[var(--accent)] px-4 text-sm font-medium text-[var(--accent-fg)] shadow-[0_8px_18px_-10px_var(--accent)] transition-colors hover:bg-[var(--accent-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
          onClick={() => setShowCreate(true)}
        >
          {t('actions.new')}
        </button></>}
      />

      <div style={{ display: 'grid', gridTemplateColumns: activeSegment ? '1fr 1.6fr' : '1fr', gap: '20px' }}>
        <SegmentList
          segments={segments}
          activeSegmentId={activeSegment?.id}
          onOpenSegment={handleOpenSegment}
          onDeleteSegment={(id) => deleteMutation.mutate({ id })}
        />

        {activeSegment && (
          <SegmentMembersPanel
            activeSegment={activeSegment}
            onClose={() => setActiveSegment(null)}
            showAddMembers={showAddMembers}
            setShowAddMembers={setShowAddMembers}
            availableCustomers={availableCustomers}
            availableQueryIsLoading={availableQuery.isLoading}
            selectedToAdd={selectedToAdd}
            toggleSelect={toggleSelect}
            onAddMembers={() => addMembersMutation.mutate({ segmentId: activeSegment.id, customerIds: selectedToAdd })}
            addMembersPending={addMembersMutation.isPending}
            members={members}
            membersQueryIsLoading={membersQuery.isLoading}
            onRemoveMember={(memberId) => removeMemberMutation.mutate({ memberId })}
          />
        )}
      </div>

      <CreateSegmentModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSubmit={handleCreate}
        isPending={createMutation.isPending}
        error={createError}
        onClearError={() => setCreateError('')}
      />
    </div>
  );
}

'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { ALL_SCREENS, type OrgConfig, type OrgPlan, type OrgRow } from '@/lib/platformPlans';
import { OrgListSidebar } from './OrgListSidebar';
import { OrgConfigPanel } from './OrgConfigPanel';
import { CreateOrgModal } from './CreateOrgModal';

// Re-exported so existing importers of these types keep working.
export type { OrgConfig, OrgRow };

interface Props { initialOrgs: OrgRow[]; locale: string }

export default function PlatformAdminClient({ initialOrgs, locale }: Props) {
  const [orgs, setOrgs] = useState<OrgRow[]>(initialOrgs);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  const selected = orgs.find((o) => o.id === selectedId) ?? null;

  const setConfig = trpc.platformAdmin.setOrgConfig.useMutation({
    onSuccess: (res) => {
      setOrgs((prev) => prev.map((o) => o.id === selectedId ? { ...o, config: res.data as OrgConfig } : o));
      setMsg('تم الحفظ بنجاح');
      setSaving(false);
    },
    onError: (err) => { setMsg('خطأ: ' + err.message); setSaving(false); },
  });

  const resetConfig = trpc.platformAdmin.resetConfig.useMutation({
    onSuccess: () => {
      setOrgs((prev) => prev.map((o) => o.id === selectedId ? { ...o, config: null } : o));
      setMsg('تمت الإعادة للافتراضي');
      setSaving(false);
    },
    onError: (err) => { setMsg('خطأ: ' + err.message); setSaving(false); },
  });

  const createOrg = trpc.platformAdmin.createOrg.useMutation({
    onSuccess: (res) => {
      const url = `${window.location.origin}/${locale}/join?token=${res.data.inviteToken}`;
      setInviteUrl(url);
      setCreating(false);
      // Refresh by reloading (server state changed)
      window.location.reload();
    },
    onError: (err) => {
      setMsg('خطأ: ' + err.message);
      setCreating(false);
    },
  });

  function selectOrg(org: OrgRow) {
    setSelectedId(org.id);
    setMsg('');
  }

  function handleSave(config: {
    plan: OrgPlan;
    isActive: boolean;
    enabledScreens: string[];
    disabledScreens: string[];
    maxUsers: number | null;
    notes: string | null;
  }) {
    if (!selectedId) return;
    setSaving(true); setMsg('');
    setConfig.mutate({ orgId: selectedId, ...config });
  }

  function handleReset() {
    if (!selectedId || !confirm('إعادة الإعدادات الافتراضية لهذه المؤسسة؟')) return;
    setSaving(true);
    resetConfig.mutate({ orgId: selectedId });
  }

  function handleCreate(data: {
    name: string;
    slug: string;
    ownerEmail: string;
    plan: OrgPlan;
    enabledScreens: string[];
    maxUsers: number | null;
    notes: string | null;
  }) {
    setCreating(true);
    createOrg.mutate({
      ...data,
      disabledScreens: ALL_SCREENS.map((s) => s.slug).filter((s) => !data.enabledScreens.includes(s)),
    });
  }

  function closeCreate() {
    setShowCreate(false);
    setInviteUrl(null);
  }

  return (
    <div className="flex h-full">
      <OrgListSidebar
        orgs={orgs}
        selectedId={selectedId}
        onSelect={selectOrg}
        onOpenCreate={() => { setInviteUrl(null); setShowCreate(true); }}
      />

      <div className="flex-1 overflow-y-auto p-6">
        <OrgConfigPanel
          selectedOrg={selected}
          saving={saving}
          msg={msg}
          onSave={handleSave}
          onReset={handleReset}
        />
      </div>

      <CreateOrgModal
        show={showCreate}
        onClose={closeCreate}
        creating={creating}
        inviteUrl={inviteUrl}
        onCreate={handleCreate}
      />
    </div>
  );
}

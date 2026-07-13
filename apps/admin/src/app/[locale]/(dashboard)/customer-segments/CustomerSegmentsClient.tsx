'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc/client';

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

const PRESET_COLORS = ['#B0885E', '#D4AF37', '#2E7D32', '#1565C0', '#6A1B9A', '#C62828', '#00695C', '#4E342E'];

export default function CustomerSegmentsClient({ initialSegments }: Props) {
  const [segments, setSegments] = useState<CustomerSegment[]>(initialSegments);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', color: '#B0885E', description: '' });
  const [activeSegment, setActiveSegment] = useState<CustomerSegment | null>(null);
  const [members, setMembers] = useState<SegmentMember[]>([]);
  const [availableCustomers, setAvailableCustomers] = useState<{ id: string; name: string; email: string | null }[]>([]);
  const [selectedToAdd, setSelectedToAdd] = useState<string[]>([]);
  const [showAddMembers, setShowAddMembers] = useState(false);
  const [createError, setCreateError] = useState('');

  const createMutation = trpc.customerSegments.create.useMutation({
    onSuccess: (res) => {
      if (res.data) {
        setSegments((prev) => [{ ...res.data!, memberCount: 0 } as CustomerSegment, ...prev]);
        setShowCreate(false);
        setCreateForm({ name: '', color: '#B0885E', description: '' });
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
    onSuccess: async () => {
      if (!activeSegment) return;
      setShowAddMembers(false);
      setSelectedToAdd([]);
      const res = await membersQuery.refetch();
      if (res.data?.data) setMembers(res.data.data);
      setSegments((prev) => prev.map((s) => s.id === activeSegment.id ? { ...s, memberCount: s.memberCount + 1 } : s));
    },
  });

  const removeMemberMutation = trpc.customerSegments.removeMember.useMutation({
    onSuccess: (_, vars) => {
      setMembers((prev) => prev.filter((m) => m.memberId !== vars.memberId));
      setSegments((prev) => prev.map((s) => s.id === activeSegment?.id ? { ...s, memberCount: s.memberCount - 1 } : s));
    },
  });

  const membersQuery = trpc.customerSegments.getMembers.useQuery(
    { segmentId: activeSegment?.id ?? '' },
    { enabled: !!activeSegment, onSuccess: (res) => { if (res.data) setMembers(res.data); } }
  );

  const availableQuery = trpc.customerSegments.getCustomersNotInSegment.useQuery(
    { segmentId: activeSegment?.id ?? '' },
    { enabled: showAddMembers && !!activeSegment, onSuccess: (res) => { if (res.data) setAvailableCustomers(res.data); } }
  );

  const handleCreate = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    if (!createForm.name.trim()) { setCreateError('اسم الشريحة مطلوب'); return; }
    createMutation.mutate({ name: createForm.name, color: createForm.color, description: createForm.description || undefined });
  };

  const handleOpenSegment = (seg: CustomerSegment) => {
    setActiveSegment(seg);
    setShowAddMembers(false);
    setSelectedToAdd([]);
  };

  const toggleSelect = (id: string) => {
    setSelectedToAdd((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const cardStyle = {
    background: 'var(--surface)',
    border: '1px solid var(--rim1)',
    borderRadius: '12px',
    padding: '20px',
  };

  const btnPrimary = {
    background: 'var(--gold)',
    color: '#111',
    border: 'none',
    borderRadius: '8px',
    padding: '8px 18px',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer',
  } as const;

  const btnSecondary = {
    background: 'transparent',
    color: 'var(--t2)',
    border: '1px solid var(--rim1)',
    borderRadius: '8px',
    padding: '8px 16px',
    fontSize: '13px',
    cursor: 'pointer',
  } as const;

  const inputStyle = {
    background: 'var(--surface)',
    border: '1px solid var(--rim1)',
    borderRadius: '8px',
    padding: '8px 12px',
    fontSize: '14px',
    color: 'var(--t1)',
    width: '100%',
    outline: 'none',
  } as const;

  return (
    <div dir="rtl" className="font-cairo p-6" style={{ color: 'var(--t1)' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', marginBottom: '4px' }}>شرائح العملاء</h1>
          <p style={{ fontSize: '13px', color: 'var(--t2)' }}>تجميع العملاء في مجموعات للحملات والتسويق المستهدف</p>
        </div>
        <button style={btnPrimary} onClick={() => setShowCreate(true)}>+ شريحة جديدة</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: activeSegment ? '1fr 1.6fr' : '1fr', gap: '20px' }}>
        {/* Segments list */}
        <div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {segments.length === 0 && (
              <div style={{ ...cardStyle, textAlign: 'center', color: 'var(--t2)', padding: '40px' }}>
                لا توجد شرائح بعد — أنشئ شريحتك الأولى
              </div>
            )}
            {segments.map((seg) => (
              <div
                key={seg.id}
                onClick={() => handleOpenSegment(seg)}
                style={{
                  ...cardStyle,
                  cursor: 'pointer',
                  borderRight: activeSegment?.id === seg.id ? `4px solid ${seg.color}` : '1px solid var(--rim1)',
                  transition: 'border 0.15s',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: seg.color, flexShrink: 0 }} />
                    <div>
                      <div style={{ fontWeight: '600', fontSize: '15px' }}>{seg.name}</div>
                      {seg.description && <div style={{ fontSize: '12px', color: 'var(--t2)', marginTop: '2px' }}>{seg.description}</div>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ fontSize: '13px', color: 'var(--t2)' }}>{seg.memberCount} عميل</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); if (confirm('حذف الشريحة؟')) deleteMutation.mutate({ id: seg.id }); }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--crimson)', fontSize: '13px' }}
                    >
                      حذف
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Members panel */}
        {activeSegment && (
          <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: activeSegment.color }} />
                <h2 style={{ fontSize: '16px', fontWeight: '700' }}>{activeSegment.name}</h2>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button style={btnSecondary} onClick={() => setShowAddMembers(!showAddMembers)}>+ إضافة عملاء</button>
                <button style={{ ...btnSecondary, fontSize: '12px' }} onClick={() => setActiveSegment(null)}>✕</button>
              </div>
            </div>

            {/* Add members panel */}
            {showAddMembers && (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--rim1)', borderRadius: '8px', padding: '14px', marginBottom: '16px' }}>
                <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '10px', color: 'var(--t2)' }}>اختر عملاء للإضافة</div>
                <div style={{ maxHeight: '180px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {availableQuery.isLoading && <div style={{ color: 'var(--t2)', fontSize: '12px' }}>جاري التحميل...</div>}
                  {availableCustomers.map((c) => (
                    <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
                      <input
                        type="checkbox"
                        checked={selectedToAdd.includes(c.id)}
                        onChange={() => toggleSelect(c.id)}
                      />
                      <span>{c.name}</span>
                      {c.email && <span style={{ color: 'var(--t2)', fontSize: '11px' }}>{c.email}</span>}
                    </label>
                  ))}
                  {!availableQuery.isLoading && availableCustomers.length === 0 && (
                    <div style={{ color: 'var(--t2)', fontSize: '12px' }}>جميع العملاء مضافون بالفعل</div>
                  )}
                </div>
                {selectedToAdd.length > 0 && (
                  <button
                    style={{ ...btnPrimary, marginTop: '10px', width: '100%' }}
                    onClick={() => addMembersMutation.mutate({ segmentId: activeSegment.id, customerIds: selectedToAdd })}
                    disabled={addMembersMutation.isLoading}
                  >
                    {addMembersMutation.isLoading ? 'جاري الإضافة...' : `إضافة ${selectedToAdd.length} عميل`}
                  </button>
                )}
              </div>
            )}

            {/* Members table */}
            <div style={{ overflowX: 'auto' }}>
              {membersQuery.isLoading && <div style={{ color: 'var(--t2)', fontSize: '13px', padding: '20px', textAlign: 'center' }}>جاري التحميل...</div>}
              {!membersQuery.isLoading && members.length === 0 && (
                <div style={{ color: 'var(--t2)', fontSize: '13px', padding: '30px', textAlign: 'center' }}>لا يوجد عملاء في هذه الشريحة</div>
              )}
              {members.length > 0 && (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--rim1)' }}>
                      <th style={{ textAlign: 'right', padding: '8px 10px', color: 'var(--t2)', fontWeight: '600' }}>الاسم</th>
                      <th style={{ textAlign: 'right', padding: '8px 10px', color: 'var(--t2)', fontWeight: '600' }}>البريد</th>
                      <th style={{ textAlign: 'right', padding: '8px 10px', color: 'var(--t2)', fontWeight: '600' }}>الهاتف</th>
                      <th style={{ padding: '8px 10px' }} />
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m) => (
                      <tr key={m.memberId} style={{ borderBottom: '1px solid var(--rim1)' }}>
                        <td style={{ padding: '9px 10px', fontWeight: '500' }}>{m.customerName}</td>
                        <td style={{ padding: '9px 10px', color: 'var(--t2)', direction: 'ltr', textAlign: 'left' }}>{m.customerEmail ?? '—'}</td>
                        <td style={{ padding: '9px 10px', color: 'var(--t2)', direction: 'ltr', textAlign: 'left' }}>{m.customerPhone ?? '—'}</td>
                        <td style={{ padding: '9px 10px', textAlign: 'center' }}>
                          <button
                            onClick={() => removeMemberMutation.mutate({ memberId: m.memberId })}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--crimson)', fontSize: '12px' }}
                          >
                            إزالة
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Create modal */}
      {showCreate && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ ...cardStyle, width: '440px', maxWidth: '95vw' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ fontSize: '16px', fontWeight: '700' }}>شريحة جديدة</h2>
              <button onClick={() => { setShowCreate(false); setCreateError(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t2)', fontSize: '18px' }}>✕</button>
            </div>
            <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ fontSize: '12px', color: 'var(--t2)', display: 'block', marginBottom: '5px' }}>اسم الشريحة *</label>
                <input
                  style={inputStyle}
                  value={createForm.name}
                  onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="مثال: عملاء VIP"
                  maxLength={100}
                />
              </div>
              <div>
                <label style={{ fontSize: '12px', color: 'var(--t2)', display: 'block', marginBottom: '5px' }}>وصف (اختياري)</label>
                <input
                  style={inputStyle}
                  value={createForm.description}
                  onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="وصف مختصر للشريحة"
                  maxLength={500}
                />
              </div>
              <div>
                <label style={{ fontSize: '12px', color: 'var(--t2)', display: 'block', marginBottom: '8px' }}>اللون</label>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCreateForm((f) => ({ ...f, color: c }))}
                      style={{
                        width: '28px', height: '28px', borderRadius: '50%', background: c, border: createForm.color === c ? '3px solid var(--t1)' : '2px solid transparent',
                        cursor: 'pointer',
                      }}
                    />
                  ))}
                </div>
              </div>
              {createError && <div style={{ color: 'var(--crimson)', fontSize: '13px' }}>{createError}</div>}
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '6px' }}>
                <button type="button" style={btnSecondary} onClick={() => { setShowCreate(false); setCreateError(''); }}>إلغاء</button>
                <button type="submit" style={btnPrimary} disabled={createMutation.isLoading}>
                  {createMutation.isLoading ? 'جاري الحفظ...' : 'إنشاء الشريحة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

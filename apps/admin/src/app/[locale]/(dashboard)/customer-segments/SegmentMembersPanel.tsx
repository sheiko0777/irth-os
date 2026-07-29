'use client';

import { type CustomerSegment, type SegmentMember } from './CustomerSegmentsClient';

type SegmentMembersPanelProps = {
  activeSegment: CustomerSegment;
  onClose: () => void;
  showAddMembers: boolean;
  setShowAddMembers: (show: boolean) => void;
  availableCustomers: { id: string; name: string; email?: string | null }[];
  availableQueryIsLoading: boolean;
  selectedToAdd: string[];
  toggleSelect: (id: string) => void;
  onAddMembers: () => void;
  addMembersPending: boolean;
  members: SegmentMember[];
  membersQueryIsLoading: boolean;
  onRemoveMember: (memberId: string) => void;
};

export function SegmentMembersPanel({
  activeSegment,
  onClose,
  showAddMembers,
  setShowAddMembers,
  availableCustomers,
  availableQueryIsLoading,
  selectedToAdd,
  toggleSelect,
  onAddMembers,
  addMembersPending,
  members,
  membersQueryIsLoading,
  onRemoveMember,
}: SegmentMembersPanelProps) {
  return (
    <div className="bg-[var(--surface)] border border-[var(--rim1)] rounded-xl p-5">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: activeSegment.color }} />
          <h2 style={{ fontSize: '16px', fontWeight: '700' }}>{activeSegment.name}</h2>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className="bg-transparent text-[var(--t2)] border border-[var(--rim1)] rounded-lg px-4 py-2 text-[13px] cursor-pointer"
            onClick={() => setShowAddMembers(!showAddMembers)}
          >
            + إضافة عملاء
          </button>
          <button
            className="bg-transparent text-[var(--t2)] border border-[var(--rim1)] rounded-lg px-4 py-2 text-[12px] cursor-pointer"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Add members panel */}
      {showAddMembers && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--rim1)', borderRadius: '8px', padding: '14px', marginBottom: '16px' }}>
          <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '10px', color: 'var(--t2)' }}>اختر عملاء للإضافة</div>
          <div style={{ maxHeight: '180px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {availableQueryIsLoading && <div style={{ color: 'var(--t2)', fontSize: '12px' }}>جاري التحميل...</div>}
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
            {!availableQueryIsLoading && availableCustomers.length === 0 && (
              <div style={{ color: 'var(--t2)', fontSize: '12px' }}>جميع العملاء مضافون بالفعل</div>
            )}
          </div>
          {selectedToAdd.length > 0 && (
            <button
              className="bg-[var(--gold)] text-void border-none rounded-lg px-[18px] py-2 text-[13px] font-semibold cursor-pointer w-full mt-[10px]"
              onClick={onAddMembers}
              disabled={addMembersPending}
            >
              {addMembersPending ? 'جاري الإضافة...' : `إضافة ${selectedToAdd.length} عميل`}
            </button>
          )}
        </div>
      )}

      {/* Members table */}
      <div style={{ overflowX: 'auto' }}>
        {membersQueryIsLoading && <div style={{ color: 'var(--t2)', fontSize: '13px', padding: '20px', textAlign: 'center' }}>جاري التحميل...</div>}
        {!membersQueryIsLoading && members.length === 0 && (
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
                      onClick={() => onRemoveMember(m.memberId)}
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
  );
}

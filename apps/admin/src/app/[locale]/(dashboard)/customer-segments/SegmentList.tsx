'use client';

import { type CustomerSegment } from './CustomerSegmentsClient';
import { EmptyState } from '@/components/ui/EmptyState';

type SegmentListProps = {
  segments: CustomerSegment[];
  activeSegmentId?: string;
  onOpenSegment: (seg: CustomerSegment) => void;
  onDeleteSegment: (id: string) => void;
};

export function SegmentList({
  segments,
  activeSegmentId,
  onOpenSegment,
  onDeleteSegment,
}: SegmentListProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {segments.length === 0 && (
        <div className="bg-[var(--surface)] border border-[var(--rim1)] rounded-xl"><EmptyState title="لا توجد شرائح بعد" hint="الشريحة بتجمّع عملاء بمعيار مشترك عشان تستهدفهم بحملة." /></div>
      )}
      {segments.map((seg) => (
        <div
          key={seg.id}
          onClick={() => onOpenSegment(seg)}
          className="bg-[var(--surface)] border border-[var(--rim1)] rounded-xl p-5 cursor-pointer"
          style={{
            borderInlineStart: activeSegmentId === seg.id ? `4px solid ${seg.color}` : '1px solid var(--rim1)',
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
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm('حذف الشريحة؟')) {
                    onDeleteSegment(seg.id);
                  }
                }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--crimson)', fontSize: '13px' }}
              >
                حذف
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

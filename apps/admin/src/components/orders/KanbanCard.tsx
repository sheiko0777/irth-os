'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { OrderStatus } from '@/lib/orderTypes';
import { GripVertical } from 'lucide-react';

export interface KanbanCardProps {
  id: string;
  orderNumber: string;
  customerName: string;
  total: string;
  createdAt: string;
  status: OrderStatus;
}

export function KanbanCard({
  id,
  orderNumber,
  customerName,
  total,
  createdAt,
  status,
}: KanbanCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    background: 'var(--card-bg, #131e2e)',
    border: '1px solid var(--rim1, #e5e7eb)',
    borderRadius: '8px',
    padding: '12px 14px',
    cursor: 'grab',
    position: 'relative' as const,
    marginBottom: '8px',
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="group">
      <div className="absolute left-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <GripVertical size={16} className="text-t3" />
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex justify-between items-start">
          <span className="font-bold" style={{ color: 'var(--gold, #d4af37)' }}>
            {orderNumber}
          </span>
          <span className="text-sm font-medium" style={{ color: 'var(--emerald, #10b981)' }}>
            {total}
          </span>
        </div>
        <div className="text-base" style={{ color: 'var(--t2, #374151)' }}>
          {customerName}
        </div>
        <div className="text-xs" style={{ color: 'var(--t4, #9ca3af)' }}>
          {createdAt}
        </div>
      </div>
    </div>
  );
}

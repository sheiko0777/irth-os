'use client';

import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { OrderStatus } from '@/lib/orderTypes';
import { KanbanCard, KanbanCardProps } from './KanbanCard';

interface KanbanColumnProps {
  status: OrderStatus;
  label: string;
  color: string;
  orders: KanbanCardProps[];
  onStatusChange: (orderId: string, newStatus: OrderStatus) => void;
}

export function KanbanColumn({
  status,
  label,
  color,
  orders,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: status,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        background: isOver ? 'var(--surface-hover, #f3f4f6)' : 'var(--surface, #f9fafb)',
        border: '1px solid var(--rim1, #e5e7eb)',
        borderRadius: '10px',
        minHeight: '500px',
        width: '220px',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div className="p-3 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            style={{ backgroundColor: color }}
            className="w-3 h-3 rounded-full"
          />
          <h3 className="font-semibold text-sm">{label}</h3>
        </div>
        <span className="bg-gray-200 text-gray-700 text-xs py-1 px-2 rounded-full font-medium">
          {orders.length}
        </span>
      </div>

      <div className="p-2 flex-1 flex flex-col gap-2 overflow-y-auto">
        <SortableContext items={orders.map(o => o.id)} strategy={verticalListSortingStrategy}>
          {orders.map((order) => (
            <KanbanCard key={order.id} {...order} />
          ))}
        </SortableContext>
      </div>
    </div>
  );
}

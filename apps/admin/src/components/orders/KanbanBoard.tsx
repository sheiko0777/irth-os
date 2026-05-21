'use client';

import { useState } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { OrderStatus, STATUS_COLUMNS } from '@/lib/orderTypes';
import { KanbanColumn } from './KanbanColumn';
import { KanbanCard, KanbanCardProps } from './KanbanCard';
import { updateOrderStatusAction } from '@/app/[locale]/(dashboard)/orders/actions';

interface KanbanBoardProps {
  initialOrders: KanbanCardProps[];
}

export function KanbanBoard({ initialOrders }: KanbanBoardProps) {
  const [orders, setOrders] = useState<KanbanCardProps[]>(initialOrders);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;

    if (!over) return;

    const activeOrderId = active.id as string;
    const overId = over.id as string;

    const activeOrder = orders.find(o => o.id === activeOrderId);
    if (!activeOrder) return;

    let newStatus: OrderStatus;

    if (STATUS_COLUMNS.some(col => col.id === overId)) {
      newStatus = overId as OrderStatus;
    } else {
      const overOrder = orders.find(o => o.id === overId);
      if (overOrder) {
        newStatus = overOrder.status;
      } else {
        return;
      }
    }

    if (activeOrder.status === newStatus) return;

    // Optimistic update
    setOrders((prev) =>
      prev.map((o) =>
        o.id === activeOrderId ? { ...o, status: newStatus } : o
      )
    );

    // Call server action
    const result = await updateOrderStatusAction(activeOrderId, newStatus);
    if (result.error) {
      // Revert on error
      setOrders((prev) =>
        prev.map((o) =>
          o.id === activeOrderId ? { ...o, status: activeOrder.status } : o
        )
      );
      console.error('Failed to update order status:', result.error);
    }
  };

  const handleStatusChange = async (orderId: string, newStatus: OrderStatus) => {
    const orderToUpdate = orders.find(o => o.id === orderId);
    if (!orderToUpdate || orderToUpdate.status === newStatus) return;

    // Optimistic update
    setOrders((prev) =>
      prev.map((o) =>
        o.id === orderId ? { ...o, status: newStatus } : o
      )
    );

    // Call server action
    const result = await updateOrderStatusAction(orderId, newStatus);
    if (result.error) {
      // Revert on error
      setOrders((prev) =>
        prev.map((o) =>
          o.id === orderId ? { ...o, status: orderToUpdate.status } : o
        )
      );
      console.error('Failed to update order status:', result.error);
    }
  };

  const activeOrder = activeId ? orders.find((o) => o.id === activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 overflow-x-auto pb-4 pt-2 px-2">
        {STATUS_COLUMNS.map((column) => {
          const columnOrders = orders.filter((o) => o.status === column.id);
          return (
            <KanbanColumn
              key={column.id}
              status={column.id}
              label={column.label}
              color={column.color}
              orders={columnOrders}
              onStatusChange={handleStatusChange}
            />
          );
        })}
      </div>

      <DragOverlay>
        {activeOrder ? <KanbanCard {...activeOrder} /> : null}
      </DragOverlay>
    </DndContext>
  );
}

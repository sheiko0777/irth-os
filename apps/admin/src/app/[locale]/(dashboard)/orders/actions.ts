'use server';

import { serverCaller } from '@/server/caller';
import { revalidatePath } from 'next/cache';
import { OrderStatus } from '@/lib/orderTypes';

export async function updateOrderStatusAction(orderId: string, status: OrderStatus) {
  try {
    const caller = await serverCaller();
    await caller.orders.updateStatus({ id: orderId, status });
    revalidatePath('/ar/orders');
    return { success: true };
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

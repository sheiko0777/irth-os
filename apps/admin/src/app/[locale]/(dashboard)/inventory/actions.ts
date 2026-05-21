'use server';

import { serverCaller } from '@/server/caller';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

export async function adjustStockAction(
  itemId: string,
  type: 'in' | 'out' | 'adjustment',
  quantity: number,
  note?: string
) {
  try {
    const caller = await serverCaller();

    // Validate inputs
    const parsedItemId = z.string().uuid().parse(itemId);
    const parsedType = z.enum(['in', 'out', 'adjustment']).parse(type);
    const parsedQuantity = z.number().int().positive().parse(quantity);
    const parsedNote = z.string().optional().parse(note);

    const result = await caller.inventory.adjust({
      itemId: parsedItemId,
      type: parsedType,
      quantity: parsedQuantity,
      note: parsedNote,
    });

    revalidatePath('/ar/inventory');
    return { success: true, newQuantity: result.data.newQuantity };
  } catch (error) {
    console.error('Failed to adjust stock:', error);
    return { error: 'Failed to adjust stock' };
  }
}

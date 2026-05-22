'use server';

import { serverCaller } from '@/server/caller';
import { revalidatePath } from 'next/cache';

export async function submitPendingAction() {
    try {
        const caller = await serverCaller();
        const result = await caller.eta.submitPending();
        revalidatePath('/[locale]/eta', 'page');
        return result.data;
    } catch (error) {
        console.error('Failed to submit pending ETA invoices', error);
        return { error: 'Failed to submit' };
    }
}

'use server';

import { serverCaller } from '@/server/caller';

export async function askAiAction(question: string) {
    try {
        const caller = await serverCaller();
        const result = await caller.finance.askAi({ question });
        return { data: result.data };
    } catch (e: unknown) {
        return { error: e instanceof Error ? e.message : String(e) };
    }
}

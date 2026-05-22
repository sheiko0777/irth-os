"use server";

import { serverCaller } from "@/server/caller";

export async function submitPendingAction() {
    const caller = await serverCaller();
    return caller.eta.submitPending();
}

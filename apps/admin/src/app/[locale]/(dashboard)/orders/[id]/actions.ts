"use server";

import { serverCaller } from "@/server/caller";
import { revalidatePath } from "next/cache";

export async function updateOrderStatusAction(orderId: string, status: "pending" | "confirmed" | "payment_failed" | "shipped" | "delivered" | "cancelled") {
    const caller = await serverCaller();
    await caller.orders.updateStatus({ id: orderId, status });
    revalidatePath(`/ar/orders/${orderId}`);
    revalidatePath(`/ar/orders`);
}

export async function setShipmentAction(orderId: string, courier: "bosta" | "aramex", trackingNumber: string) {
    const caller = await serverCaller();
    await caller.orders.setShipment({ orderId, courier, trackingNumber });
    revalidatePath(`/ar/orders/${orderId}`);
    revalidatePath(`/en/orders/${orderId}`);
}

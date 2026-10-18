import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreateReturnDialog } from "@/app/[locale]/(dashboard)/orders/[id]/CreateReturnDialog";
import { NextIntlClientProvider } from "next-intl";

// Mock next/navigation
vi.mock("next/navigation", () => ({
    useRouter: () => ({ refresh: vi.fn(), push: vi.fn() })
}));

// Mock sonner toast
vi.mock("sonner", () => ({
    toast: { success: vi.fn(), error: vi.fn() }
}));

// Mock trpc
const mutateMock = vi.fn();
vi.mock("@/lib/trpc", () => ({
    trpc: {
        returns: {
            create: {
                useMutation: () => ({
                    mutate: mutateMock,
                    isPending: false,
                    error: null
                })
            }
        }
    }
}));

// Mock crypto.randomUUID
vi.stubGlobal("crypto", {
    randomUUID: () => "mock-uuid"
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

const messages = {
    orders: {
        detail: {
            createReturn: {
                title: "Create return",
                action: "Create Return",
                reason: "Reason",
                reason_damaged: "Damaged",
                reason_wrong_item: "Wrong item",
                reason_not_as_described: "Not as described",
                reason_changed_mind: "Changed mind",
                reason_other: "Other",
                resolution: "Resolution",
                resolution_refund: "Refund",
                resolution_exchange: "Exchange",
                resolution_store_credit: "Store credit",
                resolution_none: "None",
                condition_new: "New",
                condition_good: "Good",
                condition_damaged: "Damaged",
                condition_unknown: "Unknown",
                notes: "Notes",
                notesPlaceholder: "Optional notes...",
                submit: "Submit return",
                submitting: "Submitting...",
                success: "Return created successfully",
                errorEmpty: "Please select at least one item to return."
            }
        }
    }
};

function renderDialog() {
    render(
        <NextIntlClientProvider locale="en" messages={messages}>
            <CreateReturnDialog
                orderId="order-123"
                items={[
                    { id: "item-1", sku: "SKU-1", quantity: 2, returnedQuantity: 0 },
                    { id: "item-2", sku: "SKU-2", quantity: 1, returnedQuantity: 1 } // Fully returned
                ]}
                locale="en"
            />
        </NextIntlClientProvider>
    );
}

describe("CreateReturnDialog", () => {
    it("cannot submit without selecting items", async () => {
        const user = userEvent.setup();
        renderDialog();

        // Open dialog
        await user.click(screen.getByRole("button", { name: "Create Return" }));

        // Ensure it's open
        expect(screen.getByRole("dialog", { name: "Create return" })).toBeTruthy();

        // Submit immediately
        await user.click(screen.getByRole("button", { name: "Submit return" }));

        // Should error via toast and not call mutate
        const { toast } = await import("sonner");
        expect(toast.error).toHaveBeenCalledWith("Please select at least one item to return.");
        expect(mutateMock).not.toHaveBeenCalled();
    });

    it("sends the correct payload and shows success", async () => {
        const user = userEvent.setup();
        renderDialog();

        // Open dialog
        await user.click(screen.getByRole("button", { name: "Create Return" }));

        // Set quantity for SKU-1
        const inputs = screen.getAllByRole("spinbutton");
        await user.clear(inputs[0]);
        await user.type(inputs[0], "1");

        // Type some notes
        await user.type(screen.getByPlaceholderText("Optional notes..."), "Broken box");

        // Submit
        await user.click(screen.getByRole("button", { name: "Submit return" }));

        expect(mutateMock).toHaveBeenCalledWith({
            orderId: "order-123",
            reason: "other",
            resolutionType: "none",
            notes: "Broken box",
            items: [
                { orderItemId: "item-1", quantity: 1, condition: "unknown" }
            ],
            idempotencyKey: "mock-uuid"
        });
    });
});

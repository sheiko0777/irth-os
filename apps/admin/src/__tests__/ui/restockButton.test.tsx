import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RestockButton } from "@/app/[locale]/(dashboard)/returns/[id]/RestockButton";
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
            restock: {
                useMutation: () => ({
                    mutate: mutateMock,
                    isPending: false
                })
            }
        }
    }
}));

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

const messages = {
    returns: {
        restock: "Restock",
        restocking: "Restocking...",
        restocked: "Restocked",
        restockSuccess: "Item restocked successfully",
        restockError: "Error restocking item",
        conditionHint: "Held out of sellable stock"
    }
};

function renderButton() {
    render(
        <NextIntlClientProvider locale="en" messages={messages}>
            <RestockButton returnId="ret-1" itemId="item-1" />
        </NextIntlClientProvider>
    );
}

describe("RestockButton", () => {
    it("calls restock mutation when clicked", async () => {
        const user = userEvent.setup();
        renderButton();

        const btn = screen.getByRole("button", { name: "Restock" });
        await user.click(btn);

        expect(mutateMock).toHaveBeenCalledWith({ returnId: "ret-1", itemId: "item-1" });
    });
});

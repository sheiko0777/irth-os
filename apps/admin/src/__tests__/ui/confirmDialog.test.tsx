import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

afterEach(cleanup);

function renderDialog(onConfirm: () => void | Promise<void>) {
  render(
    <ConfirmDialog
      title="Delete item"
      confirmLabel="Confirm"
      cancelLabel="Cancel"
      onConfirm={onConfirm}
    >
      <button type="button">Open confirmation</button>
    </ConfirmDialog>,
  );
}

describe("ConfirmDialog", () => {
  it("stays open and reports a rejected confirmation", async () => {
    const user = userEvent.setup();
    renderDialog(vi.fn().mockRejectedValue(new Error("Request failed")));

    await user.click(screen.getByRole("button", { name: "Open confirmation" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Request failed",
    );
    expect(screen.getByRole("dialog", { name: "Delete item" })).toBeTruthy();
  });

  it("closes after a resolved confirmation", async () => {
    const user = userEvent.setup();
    renderDialog(vi.fn().mockResolvedValue(undefined));

    await user.click(screen.getByRole("button", { name: "Open confirmation" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Delete item" })).toBeNull();
    });
  });
});

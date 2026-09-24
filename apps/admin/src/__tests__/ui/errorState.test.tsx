import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorState } from "@/components/ui/ErrorState";
import messages from "@/messages/en.json";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

// Imported after the mock so the boundary picks up the stubbed router.
const { default: DashboardError } = await import("@/app/[locale]/(dashboard)/error");

afterEach(() => {
  cleanup();
  refresh.mockClear();
});

describe("ErrorState", () => {
  it("announces the failure and shows the localised retry label", () => {
    const onRetry = vi.fn();
    render(<ErrorState title="T" message="M" onRetry={onRetry} retryLabel="Try again" />);

    expect(screen.getByRole("alert")).toHaveTextContent("T");
    fireEvent.click(screen.getByTestId("error-retry"));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("error-retry")).toHaveTextContent("Try again");
  });

  it("renders no retry button without onRetry", () => {
    render(<ErrorState />);
    expect(screen.queryByTestId("error-retry")).toBeNull();
  });
});

describe("dashboard error boundary", () => {
  it("says the page failed to load (not that it is empty) and retries by refreshing", () => {
    const reset = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <DashboardError error={new Error("db down")} reset={reset} />
      </NextIntlClientProvider>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(messages.common.error.title);
    fireEvent.click(screen.getByRole("button", { name: messages.common.error.retry }));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
  });
});

import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";
import { SectionStatus } from "@/components/ui/SectionStatus";
import messages from "@/messages/en.json";

afterEach(cleanup);

const statuses = [
  ["loaded", "Loaded"],
  ["not_applicable", "Not applicable"],
  ["not_exposed_by_provider", "Not exposed by provider"],
  ["permission_denied", "Permission denied"],
  ["fetch_failed", "Failed to load"],
] as const;

describe("SectionStatus", () => {
  it.each(statuses)(
    "renders the %s status with text and metadata",
    (status, label) => {
      render(
        <NextIntlClientProvider locale="en" messages={messages}>
          <SectionStatus status={status} />
        </NextIntlClientProvider>,
      );

      expect(screen.getByText(label)).toBeTruthy();
      expect(
        screen.getByTestId("section-status").getAttribute("data-status"),
      ).toBe(status);
    },
  );
});

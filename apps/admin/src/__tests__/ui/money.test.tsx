import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Money } from "@/components/ui/Money";

afterEach(cleanup);

describe("Money", () => {
  it("renders EGP with Western digits and two fraction digits", () => {
    render(<Money minor={123_450n} />);

    const value = screen.getByTestId("money-value");
    expect(value.textContent).toBe("1,234.50 ج.م");
    expect(value.textContent).not.toMatch(/[٠-٩]/);
    expect(value.getAttribute("dir")).toBe("ltr");
  });

  it("preserves minor units beyond Number.MAX_SAFE_INTEGER", () => {
    render(<Money minor={9_007_199_254_740_993n} />);

    expect(screen.getByTestId("money-value").textContent).toBe(
      "90,071,992,547,409.93 ج.م",
    );
  });
});

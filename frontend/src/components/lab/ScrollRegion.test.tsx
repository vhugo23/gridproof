import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ScrollRegion from "./ScrollRegion";

afterEach(() => vi.restoreAllMocks());

function dimensions(scroll: number, client: number) {
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(scroll);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(client);
}

const show = () =>
  render(
    <ScrollRegion label="Lab scene" hint="Scroll sideways.">
      <button type="button">Generator G1</button>
    </ScrollRegion>,
  );

describe("ScrollRegion", () => {
  it("is a labelled, keyboard-focusable region with a visible hint while the content overflows", () => {
    dimensions(620, 336);
    show();
    const region = screen.getByRole("region", { name: "Lab scene" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(screen.getByTestId("scroll-hint")).toHaveTextContent(
      "Scroll sideways.",
    );
    region.focus();
    expect(region).toHaveFocus();
    // The content stays reachable inside it.
    expect(
      screen.getByRole("button", { name: "Generator G1" }),
    ).toBeInTheDocument();
  });

  it("adds no tab stop and no hint when everything fits", () => {
    dimensions(842, 842);
    show();
    expect(
      screen.getByRole("region", { name: "Lab scene" }),
    ).not.toHaveAttribute("tabindex");
    expect(screen.queryByTestId("scroll-hint")).toBeNull();
  });
});

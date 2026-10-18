import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ConnectionBadge } from "./connection-badge";

describe("ConnectionBadge", () => {
  it("displays connected status", () => {
    render(<ConnectionBadge connected={true} />);
    expect(screen.getByRole("status")).toHaveTextContent("API connected");
  });

  it("displays unavailable status", () => {
    render(<ConnectionBadge connected={false} />);
    expect(screen.getByRole("status")).toHaveTextContent("API unavailable");
  });
});

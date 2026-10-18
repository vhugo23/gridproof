import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { config } from "@/test/fixtures";
import type { AssetId } from "../lab/assets";
import Inspector from "./Inspector";

function renderAsset(asset: AssetId | null) {
  return render(
    <Inspector
      asset={asset}
      config={config()}
      fieldErrors={{}}
      onChange={() => {}}
    />,
  );
}

describe("Inspector illustrations", () => {
  it.each([
    ["g1", /generator set/i],
    ["g2", /generator set/i],
    ["battery", /battery storage/i],
    ["switchgear", /switchgear lineup/i],
  ] as const)(
    "shows an illustration with a disclaimer for %s",
    (asset, alt) => {
      renderAsset(asset);
      expect(screen.getByRole("img", { name: alt })).toBeInTheDocument();
      expect(screen.getByText(/not the simulated unit/i)).toBeInTheDocument();
    },
  );

  it("keeps the configuration controls available beside the image", () => {
    renderAsset("g1");
    expect(screen.getByLabelText("Startup delay")).toBeInTheDocument();
    expect(screen.getByLabelText("Enabled")).toBeInTheDocument();
  });

  it.each(["load", "utility", null] as const)(
    "shows no illustration for %s",
    (asset) => {
      renderAsset(asset);
      expect(screen.queryByRole("img")).not.toBeInTheDocument();
    },
  );
});

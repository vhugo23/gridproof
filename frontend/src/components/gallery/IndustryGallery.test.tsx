import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { APPLICATIONS } from "./applications";
import IndustryGallery from "./IndustryGallery";

const TITLES = [
  "Power generation",
  "Motors and electrical components",
  "Battery storage and switchgear",
  "Mining and off-highway",
  "On-highway trucks and mobile power",
];

function card(title: string) {
  return screen.getByRole("button", { name: new RegExp(title) });
}

describe("IndustryGallery cards", () => {
  it("shows five application cards that are real buttons with described images", () => {
    render(<IndustryGallery onOpenLab={() => {}} />);
    const region = screen.getByRole("region", {
      name: "Industry Applications",
    });
    expect(within(region).getAllByRole("listitem")).toHaveLength(5);
    for (const title of TITLES) {
      expect(card(title)).toHaveAttribute("aria-haspopup", "dialog");
    }
    for (const img of within(region).getAllByRole("img")) {
      expect(img.getAttribute("alt")?.length).toBeGreaterThan(20);
      expect(img.getAttribute("src")).toMatch(/^\/illustrations\/.+\.svg$/);
    }
  });

  it("discloses that the artwork is illustrative and not product imagery", () => {
    render(<IndustryGallery onOpenLab={() => {}} />);
    expect(
      screen.getByText(/Illustrative artwork created for GridProof/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/depicts no specific Cummins equipment/),
    ).toBeInTheDocument();
  });
});

describe("application brief dialog", () => {
  it.each(APPLICATIONS.map((a) => [a.title, a] as const))(
    "opens the %s brief with summary and 2-4 considerations",
    (title, app) => {
      render(<IndustryGallery onOpenLab={() => {}} />);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      fireEvent.click(card(title));
      const dialog = screen.getByRole("dialog", { name: title });
      expect(within(dialog).getByText(app.summary)).toBeInTheDocument();
      const items = within(dialog).getAllByRole("listitem");
      expect(items.length).toBeGreaterThanOrEqual(2);
      expect(items.length).toBeLessThanOrEqual(4);
      expect(
        within(dialog).getByText(/does not depict specific Cummins equipment/),
      ).toBeInTheDocument();
    },
  );

  it("closes with the close button and returns focus to the card", () => {
    render(<IndustryGallery onOpenLab={() => {}} />);
    const power = card("Power generation");
    power.focus();
    fireEvent.click(power);
    fireEvent.click(
      screen.getByRole("button", { name: "Close application brief" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(power).toHaveFocus();
  });

  it("closes when the dialog fires its cancel/close path (Escape)", () => {
    render(<IndustryGallery onOpenLab={() => {}} />);
    const mining = card("Mining and off-highway");
    mining.focus();
    fireEvent.click(mining);
    const dialog = screen.getByRole("dialog") as HTMLDialogElement;
    // A real browser turns Escape into dialog.close(); the stand-in mirrors that.
    dialog.close();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mining).toHaveFocus();
  });

  it("closes on a backdrop click but not on a click inside the panel", () => {
    render(<IndustryGallery onOpenLab={() => {}} />);
    fireEvent.click(card("Power generation"));
    fireEvent.click(screen.getByRole("heading", { name: "Power generation" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("dialog"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("connects only the lab-related briefs to existing functionality", () => {
    const onOpenLab = vi.fn();
    render(<IndustryGallery onOpenLab={onOpenLab} />);

    fireEvent.click(card("Power generation"));
    fireEvent.click(
      screen.getByRole("button", {
        name: /Open Generator G1 in the Fridley lab/,
      }),
    );
    expect(onOpenLab).toHaveBeenLastCalledWith("g1");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(card("Battery storage and switchgear"));
    fireEvent.click(
      screen.getByRole("button", {
        name: /Open Battery Storage in the Fridley lab/,
      }),
    );
    expect(onOpenLab).toHaveBeenLastCalledWith("battery");

    fireEvent.click(card("Motors and electrical components"));
    expect(
      screen.getByText(/virtual lab does not model motors/),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /Open the Fridley lab/ }),
    );
    expect(onOpenLab).toHaveBeenLastCalledWith(null);
    expect(onOpenLab).toHaveBeenCalledTimes(3);

    for (const title of [
      "Mining and off-highway",
      "On-highway trucks and mobile power",
    ]) {
      fireEvent.click(card(title));
      const dialog = screen.getByRole("dialog");
      expect(
        within(dialog).getByText(/Informational brief only/),
      ).toBeInTheDocument();
      expect(within(dialog).queryByRole("button", { name: /lab/i })).toBeNull();
      fireEvent.click(
        screen.getByRole("button", { name: "Close application brief" }),
      );
    }
    expect(onOpenLab).toHaveBeenCalledTimes(3);
  });

  it("makes no capability claims beyond what exists", () => {
    const text = JSON.stringify(APPLICATIONS).toLowerCase();
    for (const banned of [
      "recommend",
      "retrofit",
      "catalog",
      "compatib",
      "savings",
      "simulator for",
    ]) {
      expect(text).not.toContain(banned);
    }
  });
});

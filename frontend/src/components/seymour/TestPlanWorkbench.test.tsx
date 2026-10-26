import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiError, json } from "@/test/fixtures";
import { ENGINE_PLAN_SAMPLE } from "@/test/enginePlanFixture";
import type { EnginePlanEvidence } from "@/lib/types";
import TestPlanWorkbench from "./TestPlanWorkbench";

afterEach(() => vi.unstubAllGlobals());

function stubApi(...responses: Response[]) {
  const fn = vi.fn();
  for (const r of responses) fn.mockResolvedValueOnce(r);
  vi.stubGlobal("fetch", fn);
  return fn;
}

const clone = (): EnginePlanEvidence => structuredClone(ENGINE_PLAN_SAMPLE);
const bodyOf = (fn: ReturnType<typeof stubApi>, call = 0) =>
  JSON.parse(String(fn.mock.calls[call][1]?.body));
const input = (name: RegExp | string) => screen.getByLabelText(name);
const check = () =>
  fireEvent.click(screen.getByRole("button", { name: "Check plan coverage" }));
const done = () => screen.findByTestId("plan-summary");
const pointGroups = () => screen.getAllByRole("group", { name: /^Point \d/ });
const reqGroups = () =>
  screen.getAllByRole("group", { name: /^Requirement \d/ });
const pointLabels = () =>
  pointGroups().map(
    (g) => (within(g).getByLabelText(/Label$/) as HTMLInputElement).value,
  );

describe("Engine Test-Plan Workbench: first view", () => {
  it("opens with labeled sample values, no network call and clear synthetic labeling", () => {
    const fn = stubApi();
    render(<TestPlanWorkbench onBack={() => {}} />);
    expect(fn).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Engine Test-Plan Workbench",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Synthetic")).toBeInTheDocument();
    expect(screen.getByText(/independent of Cummins/)).toBeInTheDocument();
    expect(screen.getByTestId("sample-note")).toHaveTextContent(
      /invented for illustration.*not\s+engine data or Cummins values/,
    );
    expect(input("Objective")).toHaveValue(
      "Synthetic mid-speed coverage check",
    );
    expect(input("Point 2 Speed (rpm)")).toHaveValue("1500");
    expect(input("Point 2 Torque (N·m)")).toHaveValue("1000");
    expect(input("Point 2 Hold (min)")).toHaveValue("20");
    expect(input("Requirement 2 Min power (kW, optional)")).toHaveValue("150");
    expect(input("Requirement 3 Min planned entries")).toHaveValue("2");
    expect(reqGroups()).toHaveLength(4);
    expect(pointGroups()).toHaveLength(4);
    expect(
      screen.getByRole("img", { name: /requirement regions on a speed/ }),
    ).toHaveAttribute("src", "/illustrations/seymour-test-plan.svg");
    expect(screen.getByText(/No result yet/)).toBeInTheDocument();
  });

  it("states before any calculation that coverage is not verification", () => {
    stubApi();
    render(<TestPlanWorkbench onBack={() => {}} />);
    const note = screen.getByTestId("scope-note");
    expect(note).toBeVisible();
    for (const phrase of [
      "Planning coverage is not verification",
      "does not show that any engine can operate there",
      "no measurements",
      "engine limits",
      "fuel, efficiency or emissions",
      "never reports a performance result",
    ]) {
      expect(note).toHaveTextContent(new RegExp(phrase.replace(/ /g, "\\s+")));
    }
  });

  it("explains each result's purpose and limits", () => {
    stubApi();
    render(<TestPlanWorkbench onBack={() => {}} />);
    const panel = within(screen.getByTestId("explanations"));
    for (const title of [
      "Theoretical shaft power",
      "Requirement regions",
      "Covered by plan, partly covered, not covered",
      "Repeated operating points",
      "Planned hold time",
      "Evidence checklist",
      "Speed-torque planning diagram",
    ])
      expect(panel.getByText(title)).toBeInTheDocument();
    expect(panel.getAllByText("Purpose:")).toHaveLength(7);
    expect(panel.getAllByText("Limits:")).toHaveLength(7);
    const hold = panel.getByText("Planned hold time").closest("details")!;
    expect(hold).toHaveTextContent(/not total elapsed test time/);
    expect(hold).toHaveTextContent(/not measured stable operation/);
    expect(
      panel.getByText("Repeated operating points").closest("details"),
    ).toHaveTextContent(/never merged/);
  });

  it("runs the back handler", () => {
    stubApi();
    const onBack = vi.fn();
    render(<TestPlanWorkbench onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: "← Map" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe("Engine Test-Plan Workbench: results", () => {
  it("sends the entered numbers to the stateless endpoint, in order", async () => {
    const fn = stubApi(json(200, ENGINE_PLAN_SAMPLE));
    render(<TestPlanWorkbench onBack={() => {}} />);
    check();
    await done();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0][0]).toBe("/api/v1/demo/engine-test-plan");
    expect(fn.mock.calls[0][1]?.method).toBe("POST");
    const body = bodyOf(fn);
    expect(body.objective).toBe("Synthetic mid-speed coverage check");
    expect(body.points).toEqual([
      { label: "Point A", rpm: 1000, torque_nm: 500, dwell_min: 10 },
      { label: "Point B", rpm: 1500, torque_nm: 1000, dwell_min: 20 },
      { label: "Point C", rpm: 1800, torque_nm: 800, dwell_min: 15 },
      { label: "Point D", rpm: 1200, torque_nm: 1300, dwell_min: 15 },
    ]);
    expect(body.requirements[1]).toEqual({
      label: "Mid-speed region",
      rpm_min: 1400,
      rpm_max: 1600,
      torque_min_nm: 900,
      torque_max_nm: 1100,
      power_min_kw: 150,
      min_points: 1,
      min_dwell_min: 0,
    });
    // A blank optional power is sent as null, not 0.
    expect(body.requirements[0].power_min_kw).toBeNull();
  });

  it("shows the server's coverage, labeled as planned coverage and never verified", async () => {
    stubApi(json(200, ENGINE_PLAN_SAMPLE));
    render(<TestPlanWorkbench onBack={() => {}} />);
    check();
    await done();

    const banner = screen.getByTestId("verification-banner");
    expect(banner).toHaveTextContent(
      "Planned coverage only · Verification: not verified",
    );
    expect(banner).toHaveTextContent(/cannot show\s+that any planned point/);

    const summary = within(screen.getByTestId("plan-summary"));
    expect(summary.getByText("Covered by plan").nextSibling).toHaveTextContent(
      "2 of 4",
    );
    expect(summary.getByText("Partly covered").nextSibling).toHaveTextContent(
      "1 of 4",
    );
    expect(summary.getByText("Not covered").nextSibling).toHaveTextContent(
      "1 of 4",
    );
    // Refinement 3: planned hold time, never total elapsed test time.
    expect(
      summary.getByText("Planned hold time").nextSibling,
    ).toHaveTextContent("60 min");
    expect(
      summary.getByText("scheduled holds only; not total elapsed test time"),
    ).toBeVisible();
    expect(
      summary.getByText("Theoretical power range").nextSibling,
    ).toHaveTextContent("52.36 to 163.36 kW");
    expect(summary.getByTestId("unmatched")).toHaveTextContent("Point D");
    expect(summary.getByTestId("plan-explanation")).toHaveTextContent(
      ENGINE_PLAN_SAMPLE.explanation,
    );

    const reqs = within(screen.getByTestId("requirements"));
    const cards = reqs.getAllByRole("listitem", { name: "" });
    expect(cards.length).toBeGreaterThanOrEqual(4);
    const status = (id: string) =>
      screen
        .getByTestId("requirements")
        .querySelector(`[data-requirement="${id}"] [data-status]`)!;
    expect(status("req-1")).toHaveTextContent("Covered by plan");
    expect(status("req-3")).toHaveTextContent("Partly covered");
    expect(status("req-4")).toHaveTextContent("Not covered");
    const r3 = screen
      .getByTestId("requirements")
      .querySelector('[data-requirement="req-3"]')!;
    expect(r3).toHaveTextContent("1 of 2 needed");
    expect(r3).toHaveTextContent("15 of 20 min needed");
  });

  it("never shows a pass, success or verified status in the results", async () => {
    stubApi(json(200, ENGINE_PLAN_SAMPLE));
    render(<TestPlanWorkbench onBack={() => {}} />);
    check();
    await done();
    const region = screen.getByRole("region", {
      name: "Plan coverage results",
    });
    const text = (region.textContent ?? "").replace(
      /not verified|nothing here is verified|or verified stable operation/gi,
      "",
    );
    expect(text).not.toMatch(/\bpass(ed|es)?\b/i);
    expect(text).not.toMatch(/verified|validated|certified|proven/i);
    expect(text).not.toMatch(/✔|✓|success/i);
  });

  it("shows the server's verdict even when it contradicts the numbers beside it", async () => {
    const contradictory = clone();
    contradictory.requirements[3].status = "covered_by_plan";
    contradictory.requirements[3].status_label = "Covered by plan";
    stubApi(json(200, contradictory));
    render(<TestPlanWorkbench onBack={() => {}} />);
    check();
    await done();
    const r4 = screen
      .getByTestId("requirements")
      .querySelector('[data-requirement="req-4"] [data-status]')!;
    expect(r4).toHaveTextContent("Covered by plan");
  });

  it("explains which bound each point misses, with the signed distance", async () => {
    stubApi(json(200, ENGINE_PLAN_SAMPLE));
    render(<TestPlanWorkbench onBack={() => {}} />);
    check();
    await done();
    const grid = screen.getByRole("region", {
      name: "Bound checks for High-torque region",
    });
    const row = grid.querySelector('[data-check="point-4"]')!;
    expect(row).toHaveTextContent("1200.00 rpm: inside");
    expect(row).toHaveTextContent("1300.00 N·m: 50.00 N·m below the minimum");
    expect(row).toHaveTextContent("No");
    const power = screen.getByRole("region", {
      name: "Bound checks for Mid-speed region",
    });
    expect(power).toHaveTextContent("Theoretical power");
    expect(power.querySelector('[data-check="point-2"]')).toHaveTextContent(
      "157.08 kW: at or above 150.00 kW",
    );
  });

  it("flags a power that displays equal to its minimum but is below it", async () => {
    const tie = clone();
    const check2 = tie.requirements[1].point_checks[1];
    check2.power = {
      met: false,
      value: 157.08,
      minimum: 157.08,
      outside_by: 0,
      equal_when_rounded: true,
    };
    stubApi(json(200, tie));
    render(<TestPlanWorkbench onBack={() => {}} />);
    check();
    await done();
    const note = screen.getByTestId("rounded-tie-req-2");
    expect(note).toHaveTextContent("Equal when rounded, not equal exactly.");
    expect(note).toHaveTextContent(/slightly below the minimum/);
    expect(
      screen
        .getByRole("region", { name: "Bound checks for Mid-speed region" })
        .querySelector('[data-check="point-2"]'),
    ).toHaveTextContent(
      /displays equal to 157\.08 kW but is slightly below it/,
    );
    expect(screen.queryByTestId("rounded-tie-req-1")).toBeNull();
  });

  it("discloses repeated coordinates without merging them", async () => {
    const repeated = clone();
    repeated.summary.repeated_conditions = [
      { rpm: 1500, torque_nm: 1000, point_ids: ["point-2", "point-3"] },
    ];
    repeated.summary.distinct_conditions = 3;
    repeated.points[1].same_conditions_as = ["point-3"];
    repeated.points[2].same_conditions_as = ["point-2"];
    stubApi(json(200, repeated));
    render(<TestPlanWorkbench onBack={() => {}} />);
    check();
    await done();
    const note = screen.getByTestId("repeated-note");
    expect(note).toHaveTextContent(
      /Point B, Point C \(1500 rpm, 1000\.00 N·m\)/,
    );
    expect(note).toHaveTextContent(
      /separate planned entry but does not add\s+distinct-condition coverage/,
    );
    expect(screen.getByTestId("plan-summary")).toHaveTextContent(
      "3 distinct speed/torque conditions",
    );
    expect(screen.getByTestId("timeline")).toHaveTextContent(
      /same speed and torque as Point C \(counted as a separate entry\)/,
    );
  });

  it("shows the ordered plan, planned hold timeline and steps between points", async () => {
    stubApi(json(200, ENGINE_PLAN_SAMPLE));
    render(<TestPlanWorkbench onBack={() => {}} />);
    check();
    await done();
    const list = within(
      screen.getByRole("list", { name: "Ordered operating points" }),
    );
    const rows = list.getAllByRole("listitem");
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent("Point A");
    expect(rows[0]).toHaveTextContent("1000 rpm · 500.00 N·m · 52.36 kW");
    expect(rows[0]).toHaveTextContent("first point");
    expect(rows[1]).toHaveTextContent(
      "step from previous: +500 rpm, +500.00 N·m",
    );
    expect(rows[2]).toHaveTextContent(
      "step from previous: +300 rpm, −200.00 N·m",
    );
    expect(rows[3]).toHaveTextContent("minute 45 to 60 of planned hold time");
    expect(rows[3]).toHaveTextContent("Matches no requirement");
    expect(screen.getByTestId("timeline")).toHaveTextContent(
      /not total elapsed test time/,
    );
    const segments = screen
      .getByTestId("hold-timeline")
      .querySelectorAll("[data-segment]");
    expect(segments).toHaveLength(4);
    expect((segments[1] as HTMLElement).style.width).toBe(
      `${(20 / 60) * 100}%`,
    );
  });

  it("draws the planning diagram from the returned numbers, without any curve or envelope", async () => {
    stubApi(json(200, ENGINE_PLAN_SAMPLE));
    render(<TestPlanWorkbench onBack={() => {}} />);
    check();
    await done();
    const figure = screen.getByTestId("plane-chart");
    const svg = within(figure).getByRole("img", {
      name: /planning diagram with 4 requirement regions and 4 planned points/,
    });
    expect(svg).toHaveAccessibleName(/not an engine map/);
    expect(svg.querySelectorAll("[data-region]")).toHaveLength(4);
    expect(svg.querySelectorAll("[data-point]")).toHaveLength(4);
    expect(
      svg.querySelector('[data-region="req-3"]')!.getAttribute("data-status"),
    ).toBe("partly_covered");
    // The only path-like element is the straight sequence line; no curve is drawn.
    expect(svg.querySelectorAll("path")).toHaveLength(0);
    expect(svg.querySelectorAll("polyline")).toHaveLength(1);
    expect(figure).toHaveTextContent(
      /draws no performance curve, limit or operating envelope/,
    );
  });

  it("highlights a chosen point on the diagram and lets it be cleared", async () => {
    stubApi(json(200, ENGINE_PLAN_SAMPLE));
    render(<TestPlanWorkbench onBack={() => {}} />);
    check();
    await done();
    const row = within(
      screen.getByRole("list", { name: "Ordered operating points" }),
    ).getAllByRole("button")[1];
    expect(row).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(row);
    expect(row).toHaveAttribute("aria-pressed", "true");
    const svg = screen.getByTestId("plane-chart");
    expect(svg.querySelector('[data-point="point-1"]')).toHaveAttribute(
      "opacity",
      "0.35",
    );
    expect(svg.querySelector('[data-point="point-2"]')).toHaveAttribute(
      "opacity",
      "1",
    );
    fireEvent.click(row);
    expect(row).toHaveAttribute("aria-pressed", "false");
    expect(svg.querySelector('[data-point="point-1"]')).toHaveAttribute(
      "opacity",
      "1",
    );
  });

  it("has a traceability matrix whose cells are readable without the symbols", async () => {
    stubApi(json(200, ENGINE_PLAN_SAMPLE));
    render(<TestPlanWorkbench onBack={() => {}} />);
    check();
    await done();
    const matrix = screen.getByRole("region", { name: "Traceability matrix" });
    expect(matrix).toHaveAttribute("tabindex", "0");
    expect(
      within(matrix).getByRole("columnheader", { name: "R3" }),
    ).toBeInTheDocument();
    expect(
      matrix.querySelector('[data-cell="point-1:req-1"]'),
    ).toHaveTextContent("matches Low-speed region");
    expect(
      matrix.querySelector('[data-cell="point-1:req-2"]'),
    ).toHaveTextContent("does not match Mid-speed region");
    // Point D matches nothing.
    for (const r of ["req-1", "req-2", "req-3", "req-4"])
      expect(
        matrix.querySelector(`[data-cell="point-4:${r}"]`),
      ).toHaveTextContent("does not match");
  });

  it("lists the evidence still required, all not started, with no way to mark anything done", async () => {
    stubApi(json(200, ENGINE_PLAN_SAMPLE));
    render(<TestPlanWorkbench onBack={() => {}} />);
    check();
    await done();
    const panel = screen.getByTestId("evidence");
    expect(panel).toHaveTextContent("Evidence still required");
    expect(panel).toHaveTextContent(
      /None of this has been collected, checked or tracked by GridProof/,
    );
    const items = panel.querySelectorAll("[data-evidence]");
    expect(items).toHaveLength(18);
    for (const item of items) expect(item).toHaveTextContent("Not started");
    expect(within(panel).queryAllByRole("checkbox")).toHaveLength(0);
    expect(within(panel).queryAllByRole("button")).toHaveLength(0);
    expect(panel).toHaveTextContent(/Authoritative capability limits/);
    expect(panel).toHaveTextContent(
      /Measured speed and torque logged during the hold at Point A/,
    );
    expect(panel).toHaveTextContent(
      /documented rationale for the gap in High-torque region/,
    );
  });

  it("lists the assumptions", async () => {
    stubApi(json(200, ENGINE_PLAN_SAMPLE));
    render(<TestPlanWorkbench onBack={() => {}} />);
    check();
    await done();
    const details = screen
      .getByText("Assumptions and what this does not model")
      .closest("details")!;
    expect(details.querySelectorAll("li")).toHaveLength(9);
    expect(details).toHaveTextContent(/independent of Cummins Inc\./);
  });

  it("flags a result as outdated once the plan is edited or reordered", async () => {
    stubApi(json(200, ENGINE_PLAN_SAMPLE));
    render(<TestPlanWorkbench onBack={() => {}} />);
    check();
    await done();
    expect(screen.queryByTestId("stale-notice")).toBeNull();
    fireEvent.change(input("Point 1 Speed (rpm)"), {
      target: { value: "1100" },
    });
    expect(screen.getByTestId("stale-notice")).toHaveTextContent(
      "The plan changed after this result. Check coverage again.",
    );
    fireEvent.change(input("Point 1 Speed (rpm)"), {
      target: { value: "1000" },
    });
    expect(screen.queryByTestId("stale-notice")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Move down point 1" }));
    expect(screen.getByTestId("stale-notice")).toBeInTheDocument();
  });
});

describe("Engine Test-Plan Workbench: editing the plan", () => {
  it("adds and removes points and requirements and moves focus sensibly", () => {
    stubApi();
    render(<TestPlanWorkbench onBack={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Add point" }));
    expect(pointGroups()).toHaveLength(5);
    expect(input("Point 5 Label")).toHaveFocus();
    expect(input("Point 5 Hold (min)")).toHaveValue("10");
    fireEvent.click(screen.getByRole("button", { name: "Remove point 5" }));
    expect(pointGroups()).toHaveLength(4);
    expect(input("Point 4 Label")).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Add requirement" }));
    expect(reqGroups()).toHaveLength(5);
    expect(input("Requirement 5 Label")).toHaveFocus();
    expect(input("Requirement 5 Min planned entries")).toHaveValue("1");
    expect(input("Requirement 5 Min planned hold (min)")).toHaveValue("0");
    fireEvent.click(
      screen.getByRole("button", { name: "Remove requirement 5" }),
    );
    expect(input("Requirement 4 Label")).toHaveFocus();
  });

  it("keeps at least one point and one requirement and stops at the limits", () => {
    stubApi();
    render(<TestPlanWorkbench onBack={() => {}} />);
    for (let i = 0; i < 3; i++)
      fireEvent.click(screen.getByRole("button", { name: "Remove point 1" }));
    expect(pointGroups()).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Remove point 1" }),
    ).toBeDisabled();
    for (let i = 0; i < 3; i++)
      fireEvent.click(
        screen.getByRole("button", { name: "Remove requirement 1" }),
      );
    expect(
      screen.getByRole("button", { name: "Remove requirement 1" }),
    ).toBeDisabled();
    for (let i = 0; i < 11; i++)
      fireEvent.click(screen.getByRole("button", { name: "Add point" }));
    expect(pointGroups()).toHaveLength(12);
    expect(screen.getByRole("button", { name: "Add point" })).toBeDisabled();
    expect(screen.getByText("12 of 12 points")).toBeInTheDocument();
    for (let i = 0; i < 9; i++)
      fireEvent.click(screen.getByRole("button", { name: "Add requirement" }));
    expect(
      screen.getByRole("button", { name: "Add requirement" }),
    ).toBeDisabled();
  }, 15_000);

  it("reorders points with buttons, keeps focus on the moved point and announces it", async () => {
    const fn = stubApi(json(200, ENGINE_PLAN_SAMPLE));
    render(<TestPlanWorkbench onBack={() => {}} />);
    expect(pointLabels()).toEqual(["Point A", "Point B", "Point C", "Point D"]);
    expect(
      screen.getByRole("button", { name: "Move up point 1" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move down point 4" }),
    ).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Move up point 2" }));
    expect(pointLabels()).toEqual(["Point B", "Point A", "Point C", "Point D"]);
    // Focus follows the moved point (now position 1, so its up button is disabled
    // and focus falls to its down button).
    expect(
      screen.getByRole("button", { name: "Move down point 1" }),
    ).toHaveFocus();
    expect(
      screen.getByText("Point B moved to position 1 of 4."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Move down point 1" }));
    expect(pointLabels()).toEqual(["Point A", "Point B", "Point C", "Point D"]);
    expect(
      screen.getByRole("button", { name: "Move down point 2" }),
    ).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Move up point 4" }));
    check();
    await done();
    expect(bodyOf(fn).points.map((p: { label: string }) => p.label)).toEqual([
      "Point A",
      "Point B",
      "Point D",
      "Point C",
    ]);
  });

  it("resets to the sample", () => {
    stubApi();
    render(<TestPlanWorkbench onBack={() => {}} />);
    fireEvent.change(input("Objective"), { target: { value: "Mine" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove point 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset to sample" }));
    expect(input("Objective")).toHaveValue(
      "Synthetic mid-speed coverage check",
    );
    expect(pointLabels()).toEqual(["Point A", "Point B", "Point C", "Point D"]);
  });
});

describe("Engine Test-Plan Workbench: errors", () => {
  it("blocks non-numeric text locally without calling the API, and clears the message on edit", () => {
    const fn = stubApi();
    render(<TestPlanWorkbench onBack={() => {}} />);
    fireEvent.change(input("Point 1 Speed (rpm)"), {
      target: { value: "abc" },
    });
    fireEvent.change(input("Point 2 Torque (N·m)"), { target: { value: "" } });
    fireEvent.change(input("Requirement 1 Speed max (rpm)"), {
      target: { value: "x" },
    });
    fireEvent.change(input("Requirement 2 Min power (kW, optional)"), {
      target: { value: "much" },
    });
    check();
    expect(fn).not.toHaveBeenCalled();
    expect(screen.getAllByText("Enter a number.")).toHaveLength(4);
    expect(input("Point 1 Speed (rpm)")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    fireEvent.change(input("Point 1 Speed (rpm)"), {
      target: { value: "900" },
    });
    expect(input("Point 1 Speed (rpm)")).toHaveAttribute(
      "aria-invalid",
      "false",
    );
    expect(screen.getAllByText("Enter a number.")).toHaveLength(3);
  });

  it("shows the server's field errors on the right inputs, keeps what was typed and clears on edit", async () => {
    stubApi(
      apiError(422, "VALIDATION_ERROR", [
        { field: "points.1.rpm", reason: "Must be between 1 and 6,000" },
        {
          field: "requirements.0.rpm_max",
          reason: "Must be at least the minimum speed",
        },
        {
          field: "requirements.2.label",
          reason: "Must be different from the other labels",
        },
        { field: "objective", reason: "Must be 1 to 80 characters" },
        {
          field: "points",
          reason:
            "Total planned hold time must not exceed 1,440 minutes; shorten the holds or remove points",
        },
      ]),
    );
    render(<TestPlanWorkbench onBack={() => {}} />);
    fireEvent.change(input("Point 2 Speed (rpm)"), {
      target: { value: "9000" },
    });
    check();
    expect(
      await screen.findByText("Check the highlighted inputs"),
    ).toBeVisible();
    for (const reason of [
      "Must be between 1 and 6,000",
      "Must be at least the minimum speed",
      "Must be different from the other labels",
      "Must be 1 to 80 characters",
      /Total planned hold time must not exceed 1,440 minutes/,
    ])
      expect(screen.getByText(reason)).toBeVisible();
    expect(input("Point 2 Speed (rpm)")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(input("Requirement 1 Speed max (rpm)")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(input("Requirement 3 Label")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(input("Objective")).toHaveAttribute("aria-invalid", "true");
    expect(input("Point 2 Speed (rpm)")).toHaveValue("9000");
    // Editing what an error refers to hides it; other errors stay.
    fireEvent.change(input("Point 2 Speed (rpm)"), {
      target: { value: "1500" },
    });
    expect(screen.queryByText("Must be between 1 and 6,000")).toBeNull();
    expect(input("Point 2 Speed (rpm)")).toHaveAttribute(
      "aria-invalid",
      "false",
    );
    expect(
      screen.getByText("Must be at least the minimum speed"),
    ).toBeVisible();
    fireEvent.change(input("Objective"), { target: { value: "Plan" } });
    expect(screen.queryByText("Must be 1 to 80 characters")).toBeNull();
  });

  it("shows an unavailable error with a retry that runs the same check again", async () => {
    const fn = stubApi(
      apiError(503, "SERVICE_UNAVAILABLE"),
      json(200, ENGINE_PLAN_SAMPLE),
    );
    render(<TestPlanWorkbench onBack={() => {}} />);
    check();
    expect(await screen.findByText("The check could not run")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      /GridProof API is unavailable/,
    );
    expect(screen.queryByTestId("plan-summary")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await done();
    expect(fn).toHaveBeenCalledTimes(2);
    expect(bodyOf(fn, 1)).toEqual(bodyOf(fn, 0));
  });

  it("says the server hit an error, not that the API is unavailable, on a 500", async () => {
    stubApi(apiError(500, "INTERNAL_ERROR"));
    render(<TestPlanWorkbench onBack={() => {}} />);
    check();
    expect(
      await screen.findByText(/The server hit an unexpected error/),
    ).toBeVisible();
    expect(screen.queryByText(/The GridProof API is unavailable/)).toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("keeps each point and requirement row inside a real list item", () => {
    stubApi();
    render(<TestPlanWorkbench onBack={() => {}} />);
    for (const [name, groups] of [
      ["Operating point list", 4],
      ["Requirement list", 4],
    ] as const) {
      const items = within(screen.getByRole("list", { name })).getAllByRole(
        "listitem",
      );
      expect(items).toHaveLength(groups);
      for (const item of items)
        expect(within(item).getAllByRole("group")).toHaveLength(1);
    }
  });

  it("gives the reorder buttons their visible text plus the point they act on", () => {
    stubApi();
    render(<TestPlanWorkbench onBack={() => {}} />);
    const up = screen.getByRole("button", { name: "Move up point 2" });
    const down = screen.getByRole("button", { name: "Move down point 2" });
    // The accessible name starts with the visible words, so voice control works.
    expect(up).toHaveTextContent(/Move up/);
    expect(down).toHaveTextContent(/Move down/);
    expect(up.getAttribute("aria-label")).toBeNull();
    expect(down.getAttribute("aria-label")).toBeNull();
  });

  it("announces the outcome in a polite status region", async () => {
    stubApi(json(200, ENGINE_PLAN_SAMPLE));
    render(<TestPlanWorkbench onBack={() => {}} />);
    check();
    await waitFor(() =>
      expect(
        screen.getByText(
          /Plan coverage checked\. 2 of 4 requirements covered by plan, 1 partly covered, 1 not covered\. Planned coverage only; not verified\./,
        ),
      ).toBeInTheDocument(),
    );
  });
});

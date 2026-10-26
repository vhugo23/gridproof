import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DUTY_CYCLE_SAMPLE, apiError, json } from "@/test/fixtures";
import DutyCycleWorkbench from "./DutyCycleWorkbench";

afterEach(() => vi.unstubAllGlobals());

function stubApi(...responses: Response[]) {
  const fn = vi.fn();
  for (const r of responses) fn.mockResolvedValueOnce(r);
  vi.stubGlobal("fetch", fn);
  return fn;
}

const bodyOf = (fn: ReturnType<typeof stubApi>, call = 0) =>
  JSON.parse(String(fn.mock.calls[call][1]?.body));
const input = (name: RegExp | string) => screen.getByLabelText(name);
const analyze = () =>
  fireEvent.click(screen.getByRole("button", { name: "Analyze duty cycle" }));
const segmentButton = (name: string) =>
  screen.getByRole("button", { name: new RegExp(`^${name}`) });

describe("Mining duty-cycle workbench", () => {
  it("opens with labeled sample values, no network call and clear synthetic labeling", () => {
    const fn = stubApi();
    render(<DutyCycleWorkbench onBack={() => {}} />);
    expect(fn).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", {
        name: "Mining Duty-Cycle Energy Analyzer",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Synthetic")).toBeInTheDocument();
    expect(screen.getByText(/independent of Cummins/)).toBeInTheDocument();
    expect(screen.getByTestId("sample-note")).toHaveTextContent(
      /invented for illustration.*not haul-truck or equipment data/,
    );
    expect(
      screen.getByText(/does not model fuel use, vehicle range, propulsion/),
    ).toBeInTheDocument();
    expect(input("Segment 2 Name")).toHaveValue("Hauling");
    expect(input("Segment 2 Power (kW)")).toHaveValue("300");
    expect(input("Segment 2 Duration (min)")).toHaveValue("12");
    expect(input("Cycles per shift")).toHaveValue("18");
    expect(screen.getAllByRole("group", { name: /Segment \d/ })).toHaveLength(
      4,
    );
    expect(
      screen.getByRole("img", { name: /mining haul truck/ }),
    ).toHaveAttribute("src", "/illustrations/mining-vehicles.svg");
    expect(screen.getByText(/No result yet/)).toBeInTheDocument();
  });

  it("sends the entered numbers to the stateless endpoint and shows the server's results", async () => {
    const fn = stubApi(json(200, DUTY_CYCLE_SAMPLE));
    render(<DutyCycleWorkbench onBack={() => {}} />);
    analyze();
    await screen.findByTestId("cycle-summary");

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0][0]).toBe("/api/v1/demo/duty-cycle");
    expect(fn.mock.calls[0][1]?.method).toBe("POST");
    expect(bodyOf(fn)).toEqual({
      segments: [
        { name: "Loading", power_kw: 120, duration_min: 3 },
        { name: "Hauling", power_kw: 300, duration_min: 12 },
        { name: "Dumping", power_kw: 90, duration_min: 2 },
        { name: "Returning", power_kw: 60, duration_min: 8 },
      ],
      cycles_per_shift: 18,
    });

    expect(screen.getByTestId("results-basis")).toHaveTextContent(
      "Calculated from the illustrative power profile you entered. These are not measurements of any haul truck or machine.",
    );
    const summary = within(screen.getByTestId("cycle-summary"));
    expect(summary.getByText("77.00 kWh")).toBeVisible();
    expect(summary.getByText("25.00 min")).toBeVisible();
    expect(summary.getByText("1386.00 kWh")).toBeVisible();
    expect(summary.getByText("Shift energy (18 cycles)")).toBeVisible();
    expect(summary.getByText("450.00 min")).toBeVisible();
    expect(summary.getByText("184.80 kW")).toBeVisible();
    expect(summary.getByText("300.00 kW")).toBeVisible();

    expect(screen.getByTestId("dominance")).toHaveTextContent(
      /^What uses the most energyHauling uses the most energy: 60\.00 kWh of 77\.00 kWh \(77\.92% of cycle energy\)/,
    );
    // Hauling alone carries the "Most energy" marker.
    expect(screen.getAllByText("Most energy")).toHaveLength(1);
    expect(
      within(segmentButton("Hauling")).getByText("Most energy"),
    ).toBeVisible();
    expect(
      within(segmentButton("Hauling")).getByText(/60\.00 kWh/),
    ).toBeVisible();
    expect(within(segmentButton("Hauling")).getByText(/77\.92%/)).toBeVisible();
    expect(within(segmentButton("Dumping")).getByText(/3\.90%/)).toBeVisible();
    expect(
      screen.getByText(/can add up to slightly more or less than 100%/),
    ).toBeVisible();
    expect(screen.getByText(/Backend assumption one/)).toBeInTheDocument();
  });

  it("draws the bars from the server's shares and marks dominance from the server's ids, never recomputing", async () => {
    const lie = structuredClone(DUTY_CYCLE_SAMPLE);
    // Contradicts its own numbers on purpose: the UI must follow the response.
    lie.dominant_segment_ids = ["segment-1"];
    lie.segments[0].is_dominant = true;
    lie.segments[1].is_dominant = false;
    lie.segments[0].share_of_cycle_energy_pct = 12.34;
    stubApi(json(200, lie));
    render(<DutyCycleWorkbench onBack={() => {}} />);
    analyze();
    await screen.findByTestId("cycle-summary");
    expect(
      within(segmentButton("Loading")).getByText("Most energy"),
    ).toBeVisible();
    expect(
      within(segmentButton("Hauling")).queryByText("Most energy"),
    ).toBeNull();
    const bar = screen.getByTestId("share-bar");
    expect(bar.querySelector('[data-slice="segment-1"]')).toHaveStyle({
      width: "12.34%",
    });
    expect(bar.querySelector('[data-slice="segment-2"]')).toHaveStyle({
      width: "77.92%",
    });
  });

  it("marks every tied segment and handles a cycle with no energy", async () => {
    const tie = structuredClone(DUTY_CYCLE_SAMPLE);
    tie.dominant_segment_ids = ["segment-1", "segment-2"];
    tie.explanation = "Loading and Hauling tie for the most energy.";
    stubApi(json(200, tie));
    render(<DutyCycleWorkbench onBack={() => {}} />);
    analyze();
    await screen.findByTestId("cycle-summary");
    expect(screen.getAllByText("Most energy")).toHaveLength(2);

    const none = structuredClone(DUTY_CYCLE_SAMPLE);
    none.dominant_segment_ids = [];
    none.explanation = "The cycle uses no energy, so no segment dominates.";
    stubApi(json(200, none));
    analyze();
    await waitFor(() =>
      expect(screen.queryAllByText("Most energy")).toHaveLength(0),
    );
    expect(screen.getByTestId("dominance")).toHaveTextContent(/uses no energy/);
  });

  it("lets a segment be chosen with the keyboard-operable toggle and shows its server details", async () => {
    stubApi(json(200, DUTY_CYCLE_SAMPLE));
    render(<DutyCycleWorkbench onBack={() => {}} />);
    analyze();
    await screen.findByTestId("cycle-summary");
    expect(screen.queryByTestId("segment-focus")).toBeNull();

    const hauling = segmentButton("Hauling");
    expect(hauling).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(hauling);
    expect(hauling).toHaveAttribute("aria-pressed", "true");
    const focus = within(
      screen.getByRole("region", { name: "Details for Hauling" }),
    );
    expect(focus.getByText("300.00 kW")).toBeVisible();
    expect(focus.getByText("12.00 min")).toBeVisible();
    expect(focus.getByText("60.00 kWh")).toBeVisible();
    expect(focus.getByText("77.92%")).toBeVisible();
    expect(focus.getByText(/most energy in the cycle/)).toBeVisible();

    // Another segment replaces it; choosing it again clears the choice.
    fireEvent.click(segmentButton("Dumping"));
    expect(hauling).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByRole("region", { name: "Details for Dumping" }),
    ).toBeVisible();
    fireEvent.click(segmentButton("Dumping"));
    expect(screen.queryByTestId("segment-focus")).toBeNull();
    expect(
      screen.getByTestId("share-bar").querySelector("[data-slice]"),
    ).toHaveStyle({ opacity: "1" });
  });

  it("adds, edits and removes segments within limits and sends exactly what is shown", async () => {
    const fn = stubApi(json(200, DUTY_CYCLE_SAMPLE));
    render(<DutyCycleWorkbench onBack={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Add segment" }));
    expect(screen.getAllByRole("group", { name: /Segment \d/ })).toHaveLength(
      5,
    );
    fireEvent.change(input("Segment 5 Name"), { target: { value: "Waiting" } });
    fireEvent.change(input("Segment 5 Power (kW)"), { target: { value: "0" } });
    fireEvent.change(input("Segment 5 Duration (min)"), {
      target: { value: "1.5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove segment 1" }));
    expect(screen.getAllByRole("group", { name: /Segment \d/ })).toHaveLength(
      4,
    );
    expect(input("Segment 1 Name")).toHaveValue("Hauling");
    analyze();
    await screen.findByTestId("cycle-summary");
    expect(bodyOf(fn).segments).toEqual([
      { name: "Hauling", power_kw: 300, duration_min: 12 },
      { name: "Dumping", power_kw: 90, duration_min: 2 },
      { name: "Returning", power_kw: 60, duration_min: 8 },
      { name: "Waiting", power_kw: 0, duration_min: 1.5 },
    ]);
  });

  it("limits the segment count and keeps at least one segment", () => {
    stubApi();
    render(<DutyCycleWorkbench onBack={() => {}} />);
    const add = screen.getByRole("button", { name: "Add segment" });
    for (let i = 0; i < 8; i++) fireEvent.click(add);
    expect(screen.getAllByRole("group", { name: /Segment \d/ })).toHaveLength(
      12,
    );
    expect(add).toBeDisabled();
    expect(screen.getByText("12 of 12 segments")).toBeInTheDocument();
    for (let i = 0; i < 11; i++)
      fireEvent.click(screen.getByRole("button", { name: "Remove segment 1" }));
    expect(screen.getAllByRole("group", { name: /Segment \d/ })).toHaveLength(
      1,
    );
    expect(
      screen.getByRole("button", { name: "Remove segment 1" }),
    ).toBeDisabled();
  });

  it("restores the sample values on request", () => {
    stubApi();
    render(<DutyCycleWorkbench onBack={() => {}} />);
    fireEvent.change(input("Segment 2 Power (kW)"), { target: { value: "5" } });
    fireEvent.change(input("Cycles per shift"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Add segment" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset to sample" }));
    expect(input("Segment 2 Power (kW)")).toHaveValue("300");
    expect(input("Cycles per shift")).toHaveValue("18");
    expect(screen.getAllByRole("group", { name: /Segment \d/ })).toHaveLength(
      4,
    );
  });

  it("blocks non-numeric text locally without calling the API, and clears the message on edit", () => {
    const fn = stubApi();
    render(<DutyCycleWorkbench onBack={() => {}} />);
    fireEvent.change(input("Segment 1 Power (kW)"), {
      target: { value: "abc" },
    });
    fireEvent.change(input("Segment 3 Duration (min)"), {
      target: { value: "" },
    });
    fireEvent.change(input("Cycles per shift"), { target: { value: "x" } });
    analyze();
    expect(fn).not.toHaveBeenCalled();
    expect(screen.getAllByText("Enter a number.")).toHaveLength(3);
    expect(input("Segment 1 Power (kW)")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    fireEvent.change(input("Segment 1 Power (kW)"), {
      target: { value: "120" },
    });
    expect(input("Segment 1 Power (kW)")).toHaveAttribute(
      "aria-invalid",
      "false",
    );
    expect(screen.getAllByText("Enter a number.")).toHaveLength(2);
  });

  it("shows the server's field errors on the right inputs and keeps what was typed", async () => {
    stubApi(
      apiError(422, "VALIDATION_ERROR", [
        { field: "segments.1.power_kw", reason: "Must be between 0 and 10000" },
        {
          field: "segments.2.name",
          reason: "Must be different from the other segment names",
        },
        {
          field: "cycles_per_shift",
          reason:
            "Cycle duration x cycles per shift must not exceed 1,440 minutes; at most 57 cycles fit this cycle",
        },
      ]),
    );
    render(<DutyCycleWorkbench onBack={() => {}} />);
    fireEvent.change(input("Segment 2 Power (kW)"), {
      target: { value: "20000" },
    });
    fireEvent.change(input("Cycles per shift"), { target: { value: "58" } });
    analyze();
    expect(
      await screen.findByText("Check the highlighted inputs"),
    ).toBeVisible();
    expect(screen.getByText("Must be between 0 and 10000")).toBeVisible();
    expect(
      screen.getByText("Must be different from the other segment names"),
    ).toBeVisible();
    expect(screen.getByText(/at most 57 cycles fit this cycle/)).toBeVisible();
    expect(input("Segment 2 Power (kW)")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(input("Segment 3 Name")).toHaveAttribute("aria-invalid", "true");
    expect(input("Cycles per shift")).toHaveAttribute("aria-invalid", "true");
    expect(input("Segment 2 Power (kW)")).toHaveValue("20000");

    // Editing a field clears the error that referred to its submitted value.
    fireEvent.change(input("Segment 2 Power (kW)"), {
      target: { value: "300" },
    });
    expect(screen.queryByText("Must be between 0 and 10000")).toBeNull();
    fireEvent.change(input("Cycles per shift"), { target: { value: "57" } });
    expect(screen.queryByText(/at most 57 cycles fit/)).toBeNull();
  });

  it("explains an unavailable API and retries with the same inputs", async () => {
    const fn = stubApi(
      apiError(503, "DATABASE_UNAVAILABLE"),
      json(200, DUTY_CYCLE_SAMPLE),
    );
    render(<DutyCycleWorkbench onBack={() => {}} />);
    analyze();
    expect(
      await screen.findByText(/The GridProof API is unavailable/),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByTestId("cycle-summary");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(bodyOf(fn, 1)).toEqual(bodyOf(fn, 0));
  });

  it("marks a result as outdated once any input changes", async () => {
    stubApi(json(200, DUTY_CYCLE_SAMPLE));
    render(<DutyCycleWorkbench onBack={() => {}} />);
    analyze();
    await screen.findByTestId("cycle-summary");
    expect(screen.queryByText(/inputs changed after this result/)).toBeNull();
    fireEvent.change(input("Segment 1 Name"), {
      target: { value: "Loading 2" },
    });
    expect(screen.getByText(/inputs changed after this result/)).toBeVisible();
  });

  it("keeps flagging an earlier result as outdated after a failed re-run", async () => {
    stubApi(
      json(200, DUTY_CYCLE_SAMPLE),
      apiError(422, "VALIDATION_ERROR", [
        { field: "cycles_per_shift", reason: "Must be between 1 and 500" },
      ]),
    );
    render(<DutyCycleWorkbench onBack={() => {}} />);
    analyze();
    await screen.findByTestId("cycle-summary");
    fireEvent.change(input("Cycles per shift"), { target: { value: "900" } });
    analyze();
    expect(await screen.findByText("Must be between 1 and 500")).toBeVisible();
    // The 77 kWh result belongs to the old inputs and must still say so.
    expect(screen.getByTestId("cycle-summary")).toBeInTheDocument();
    expect(screen.getByText(/inputs changed after this result/)).toBeVisible();
  });

  it("announces completion politely and never touches the session or configuration APIs", async () => {
    const fn = stubApi(json(200, DUTY_CYCLE_SAMPLE));
    render(<DutyCycleWorkbench onBack={() => {}} />);
    analyze();
    await waitFor(() =>
      expect(
        screen.getByText(
          /Duty cycle analysis complete. 77.00 kWh per cycle and 1386.00 kWh per shift across 4 segments/,
        ),
      ).toBeInTheDocument(),
    );
    const urls = fn.mock.calls.map(([u]) => String(u));
    expect(urls).toEqual(["/api/v1/demo/duty-cycle"]);
    expect(urls.some((u) => /session|configurations/.test(u))).toBe(false);
  });

  it("goes back to the map", () => {
    const onBack = vi.fn();
    stubApi();
    render(<DutyCycleWorkbench onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: /← Map/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("makes no capability claims beyond what exists", async () => {
    stubApi(json(200, DUTY_CYCLE_SAMPLE));
    const { container } = render(<DutyCycleWorkbench onBack={() => {}} />);
    analyze();
    await screen.findByTestId("cycle-summary");
    const text = (container.textContent ?? "").toLowerCase();
    for (const banned of [
      "certified",
      "compliant",
      "guarantee",
      "official",
      "best",
      "optimal",
      "we recommend",
      "winner",
      "ranking:",
      "efficient",
      "fuel saving",
    ]) {
      expect(text).not.toContain(banned);
    }
  });
});

describe("Mining duty-cycle workbench: list semantics", () => {
  it("keeps every segment row inside a real list item", () => {
    stubApi();
    render(<DutyCycleWorkbench onBack={() => {}} />);
    const items = within(
      screen.getByRole("list", { name: "Segments" }),
    ).getAllByRole("listitem");
    expect(items).toHaveLength(4);
    for (const item of items)
      expect(within(item).getAllByRole("group")).toHaveLength(1);
  });
});

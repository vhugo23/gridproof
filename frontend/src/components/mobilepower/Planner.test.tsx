import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MOBILE_POWER_SAMPLE, apiError, json } from "@/test/fixtures";
import Planner from "./Planner";

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
const calculate = () =>
  fireEvent.click(
    screen.getByRole("button", { name: "Calculate site demand" }),
  );
const loadButton = (name: string) =>
  screen.getByRole("button", { name: new RegExp(`^${name}`) });
const loadGroups = () => screen.getAllByRole("group", { name: /Load \d/ });
const done = () => screen.findByTestId("site-summary");

describe("Mobile-Site Power Planner: first view", () => {
  it("opens with labeled sample values, no network call and clear synthetic labeling", () => {
    const fn = stubApi();
    render(<Planner onBack={() => {}} />);
    expect(fn).not.toHaveBeenCalled();
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Mobile-Site Power Planner",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Synthetic")).toBeInTheDocument();
    expect(screen.getByText(/independent of Cummins/)).toBeInTheDocument();
    expect(screen.getByTestId("sample-note")).toHaveTextContent(
      /invented for illustration.*not equipment data/,
    );
    expect(input("Load 3 Name")).toHaveValue("Welding machines");
    expect(input("Load 3 Quantity")).toHaveValue("3");
    expect(input("Load 3 Rated (kW)")).toHaveValue("12.00");
    expect(input("Load 3 Simultaneity")).toHaveValue("0.50");
    expect(input("Capacity margin")).toHaveValue("25");
    expect(loadGroups()).toHaveLength(5);
    expect(
      screen.getByRole("img", { name: /long-haul tractor with a sleeper cab/ }),
    ).toHaveAttribute("src", "/illustrations/on-highway-trucks.svg");
    expect(screen.getByText(/No result yet/)).toBeInTheDocument();
  });

  it("states the scope limits and the nature of simultaneity factors before any calculation", () => {
    stubApi();
    render(<Planner onBack={() => {}} />);
    // Refinement B: steady-state kW only, visible without opening anything.
    const scope = screen.getByTestId("scope-note");
    expect(scope).toBeVisible();
    for (const phrase of [
      "Steady-state real power (kW) only",
      "kVA",
      "power factor",
      "voltage",
      "motor starting",
      "step loading",
      "derating",
      "protection",
      "fuel",
      "emissions",
      "full equipment suitability",
      "not the truck or trailer",
    ]) {
      expect(scope).toHaveTextContent(phrase);
    }
    // Refinement A: user-entered planning assumption, not a measurement.
    const note = screen.getByTestId("simultaneity-note");
    expect(note).toBeVisible();
    expect(note).toHaveTextContent(/your planning\s+assumption/);
    expect(note).toHaveTextContent(/not a measured peak concurrency/);
    expect(note).toHaveTextContent(/physical\s+operating schedule/);
  });

  it("explains each calculation's purpose and limits", () => {
    stubApi();
    render(<Planner onBack={() => {}} />);
    const panel = within(screen.getByTestId("explanations"));
    for (const title of [
      "Connected load",
      "Simultaneous (modeled) demand",
      "Required capacity with margin",
      "Contribution by load",
      "Package comparison",
      "Capacity ladder",
    ]) {
      expect(panel.getByText(title)).toBeInTheDocument();
    }
    expect(panel.getAllByText("Purpose:")).toHaveLength(6);
    expect(panel.getAllByText("Limits:")).toHaveLength(6);
    const text = panel.getByText("Contribution by load").closest("details")!;
    expect(text).toHaveTextContent(/not a ranking of anything else/);
    expect(text).toHaveTextContent(/in the order you\s+entered the loads/);
    expect(
      panel.getByText("Capacity ladder").closest("details"),
    ).toHaveTextContent(/hatched band/);
  });
});

describe("Mobile-Site Power Planner: results", () => {
  it("sends the entered numbers to the stateless endpoint and shows the server's results", async () => {
    const fn = stubApi(json(200, MOBILE_POWER_SAMPLE));
    render(<Planner onBack={() => {}} />);
    calculate();
    await done();

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0][0]).toBe("/api/v1/demo/mobile-power");
    expect(fn.mock.calls[0][1]?.method).toBe("POST");
    expect(bodyOf(fn)).toEqual({
      loads: [
        {
          name: "LED floodlights",
          quantity: 8,
          rated_kw: 0.4,
          simultaneity_factor: 1,
        },
        {
          name: "Cabin HVAC",
          quantity: 2,
          rated_kw: 7.5,
          simultaneity_factor: 0.8,
        },
        {
          name: "Welding machines",
          quantity: 3,
          rated_kw: 12,
          simultaneity_factor: 0.5,
        },
        {
          name: "Air compressor",
          quantity: 1,
          rated_kw: 22,
          simultaneity_factor: 0.75,
        },
        {
          name: "Water pumps",
          quantity: 2,
          rated_kw: 5.5,
          simultaneity_factor: 0.5,
        },
      ],
      capacity_margin_pct: 25,
    });

    // Hand-calculated sample: 87.20 / 55.20 / 69.00 / 109.00.
    const summary = within(screen.getByTestId("site-summary"));
    expect(summary.getByText("87.20 kW")).toBeVisible();
    expect(summary.getByText("55.20 kW")).toBeVisible();
    expect(summary.getByText("63.30%")).toBeVisible();
    expect(summary.getByText("69.00 kW")).toBeVisible();
    expect(summary.getByText("109.00 kW")).toBeVisible();
    expect(summary.getByText("Required with 25% margin")).toBeVisible();
    // 55.20 kW is described as modeled demand from the user's assumptions.
    expect(summary.getByText("Simultaneous (modeled) demand")).toBeVisible();
    expect(
      summary.getByText(
        "from your simultaneity assumptions; not a measured or guaranteed peak",
      ),
    ).toBeVisible();
    expect(screen.getByTestId("dominance")).toHaveTextContent(
      /^The load with the most modeled demand is Welding machines: 18\.00 kW of 55\.20 kW \(32\.61% of modeled demand\)/,
    );
    expect(screen.getByTestId("results-basis")).toHaveTextContent(
      /steady-state kW only.*not\s+measurements/,
    );

    // Welding machines alone carries the marker; contributions are in entered order.
    expect(screen.getAllByText("Largest demand")).toHaveLength(1);
    expect(
      within(loadButton("Welding machines")).getByText("Largest demand"),
    ).toBeVisible();
    expect(
      within(loadButton("Welding machines")).getByText(/18\.00 kW · 32\.61%/),
    ).toBeVisible();
    expect(
      within(loadButton("LED floodlights")).getByText(/3\.20 kW · 5\.80%/),
    ).toBeVisible();
    expect(
      within(screen.getByRole("list", { name: "Demand by load" }))
        .getAllByRole("button")
        .map((b) => b.getAttribute("data-load")),
    ).toEqual(["load-1", "load-2", "load-3", "load-4", "load-5"]);
    expect(
      within(screen.getByTestId("contribution")).getByText(
        /can add up to slightly more or less than 100%/,
      ),
    ).toBeVisible();
    expect(screen.getByText(/Backend assumption one/)).toBeInTheDocument();
  });

  it("shows the neutral package categories exactly as the server returns them, in fixed order", async () => {
    stubApi(json(200, MOBILE_POWER_SAMPLE));
    render(<Planner onBack={() => {}} />);
    calculate();
    await done();

    const list = screen.getByRole("list", { name: "Synthetic packages" });
    const cards = within(list).getAllByRole("listitem");
    expect(cards.map((c) => c.getAttribute("data-package"))).toEqual([
      "mobile-m1",
      "mobile-m2",
      "mobile-m3",
      "mobile-m4",
    ]);
    const labels = cards.map((c) =>
      c.querySelector("[data-category]")?.textContent?.replace(/^[✕◐●]\s*/, ""),
    );
    expect(labels).toEqual([
      "Does not meet modeled demand",
      "Does not meet modeled demand",
      "Meets modeled demand only",
      "Meets both modeled and all-simultaneous demand",
    ]);

    const m3 = within(cards[2]);
    expect(m3.getByText("Synthetic Mobile Package M3")).toBeVisible();
    expect(m3.getByText("69.00 kW <= 100.00 kW")).toBeVisible();
    expect(m3.getByText("109.00 kW <= 100.00 kW")).toBeVisible();
    expect(
      m3.getByText(/headroom 31\.00 kW · 69\.00% utilization/),
    ).toBeVisible();
    expect(
      m3.getByText(/headroom −9\.00 kW · 109\.00% utilization/),
    ).toBeVisible();
    expect(m3.getByText("Meets")).toBeVisible();
    expect(m3.getByText("Does not meet")).toBeVisible();
    expect(
      m3.getByText("Backend explanation for package M3."),
    ).toBeInTheDocument();
  });

  it("never ranks, recommends or singles out a package", async () => {
    stubApi(json(200, MOBILE_POWER_SAMPLE));
    const { container } = render(<Planner onBack={() => {}} />);
    calculate();
    await done();
    const text = (container.textContent ?? "").toLowerCase();
    for (const banned of [
      "certified",
      "compliant",
      "we guarantee",
      "official",
      "best",
      "optimal",
      "we recommend",
      "winner",
      "ranking:",
      "top pick",
      "smallest",
      "efficient",
    ]) {
      expect(text).not.toContain(banned);
    }
    expect(text).toContain("nothing is recommended");
    // No element is marked as chosen or preferred.
    expect(container.querySelector("[aria-selected='true']")).toBeNull();
    expect(container.querySelector("[aria-current]")).toBeNull();
  });

  it("draws bars, markers and ticks from the server's numbers and verdicts, never recomputing", async () => {
    const lie = structuredClone(MOBILE_POWER_SAMPLE);
    // Contradicts its own numbers on purpose: the UI must follow the response.
    lie.dominant_load_ids = ["load-1"];
    lie.loads[0].is_dominant = true;
    lie.loads[2].is_dominant = false;
    lie.loads[0].share_of_demand_pct = 12.34;
    lie.packages[0].category = "meets_modeled_and_all_simultaneous";
    lie.packages[0].category_label =
      "Meets both modeled and all-simultaneous demand";
    lie.totals.required_kw = 70;
    stubApi(json(200, lie));
    render(<Planner onBack={() => {}} />);
    calculate();
    await done();

    expect(
      within(loadButton("LED floodlights")).getByText("Largest demand"),
    ).toBeVisible();
    expect(
      within(loadButton("Welding machines")).queryByText("Largest demand"),
    ).toBeNull();
    const bar = screen.getByTestId("share-bar");
    expect(bar.querySelector('[data-slice="load-1"]')).toHaveStyle({
      width: "12.34%",
    });
    expect(bar.querySelector('[data-slice="load-3"]')).toHaveStyle({
      width: "32.61%",
    });
    const m1 = document.querySelector('[data-package="mobile-m1"]')!;
    expect(m1.querySelector("[data-category]")).toHaveTextContent(
      "Meets both modeled and all-simultaneous demand",
    );
    expect(
      within(screen.getByTestId("site-summary")).getByText("70.00 kW"),
    ).toBeVisible();
  });

  it("explains visibly when a requirement displays equal to the rating but still fails", async () => {
    // 320.01 kW x 0.25 x 1.25 = 100.003125 kW exactly: the server serializes 100.00,
    // judges it above the 100 kW rating, and reports headroom 0.00.
    const tie = structuredClone(MOBILE_POWER_SAMPLE);
    tie.totals.required_kw = 100;
    const m3 = tie.packages[2];
    m3.modeled_demand = {
      status: "does_not_meet",
      comparator: "<=",
      required: 100,
      capacity: 100,
      headroom_kw: 0,
      utilization_pct: 100,
    };
    m3.category = "does_not_meet_modeled";
    m3.category_label = "Does not meet modeled demand";
    m3.explanation =
      "The required 100.00 kW is above the 100.00 kW rating by less than 0.01 kW. The comparison uses exact values.";
    stubApi(json(200, tie));
    render(<Planner onBack={() => {}} />);
    calculate();
    await done();

    const card = within(
      document.querySelector('[data-package="mobile-m3"]') as HTMLElement,
    );
    expect(card.getByText("100.00 kW <= 100.00 kW")).toBeVisible();
    // Both the modeled and the all-simultaneous comparison fail for this package.
    expect(card.getAllByText("Does not meet")).toHaveLength(2);
    // Visible without opening anything, and it carries the server's own explanation.
    const note = screen.getByTestId("rounded-tie-mobile-m3");
    expect(note).toBeVisible();
    expect(note).toHaveTextContent("Equal when rounded, not equal exactly.");
    expect(note).toHaveTextContent(/compares the exact\s+values/);
    expect(note).toHaveTextContent(
      /above the 100\.00 kW rating by less than 0\.01 kW/,
    );
    // Other packages and genuine passes get no such note.
    expect(screen.queryByTestId("rounded-tie-mobile-m1")).toBeNull();
    expect(screen.queryByTestId("rounded-tie-mobile-m4")).toBeNull();
  });

  it("shows no equal-when-rounded note for the ordinary sample", async () => {
    stubApi(json(200, MOBILE_POWER_SAMPLE));
    render(<Planner onBack={() => {}} />);
    calculate();
    await done();
    expect(document.querySelector("[data-testid^='rounded-tie']")).toBeNull();
  });

  it("marks every tied dominant load", async () => {
    const tie = structuredClone(MOBILE_POWER_SAMPLE);
    tie.dominant_load_ids = ["load-1", "load-2"];
    tie.explanation =
      "LED floodlights and Cabin HVAC tie for the most modeled demand.";
    stubApi(json(200, tie));
    render(<Planner onBack={() => {}} />);
    calculate();
    await done();
    expect(screen.getAllByText("Largest demand")).toHaveLength(2);
  });

  it("explains what the ladder shows and draws one tick per package at the server's rating", async () => {
    stubApi(json(200, MOBILE_POWER_SAMPLE));
    render(<Planner onBack={() => {}} />);
    calculate();
    await done();
    const ladder = screen.getByTestId("capacity-ladder");
    // Max drawn scale is the larger of the top rating and the bound, plus headroom.
    const max = 150 * 1.08;
    for (const [id, kw] of [
      ["mobile-m1", 30],
      ["mobile-m2", 60],
      ["mobile-m3", 100],
      ["mobile-m4", 150],
    ] as const) {
      const left = (ladder.querySelector(`[data-tick="${id}"]`) as HTMLElement)
        .style.left;
      expect(parseFloat(left)).toBeCloseTo((kw / max) * 100, 5);
    }
    // 69 / (150 x 1.08) of the drawn width: layout only, the numbers come from the server.
    expect(
      parseFloat(
        (ladder.querySelector('[data-marker="required-fill"]') as HTMLElement)
          .style.width,
      ),
    ).toBeCloseTo((69 / max) * 100, 5);
    expect(ladder).toHaveTextContent(
      /Scale in kW: required capacity 69\.00 kW, all-simultaneous requirement 109\.00 kW; package ratings 30\.00, 60\.00, 100\.00, 150\.00 kW\. Ticks are listed by rating, not ranked\./,
    );
    expect(ladder).toHaveTextContent(/Extra needed if every load ran at once/);
    expect(ladder).toHaveTextContent(
      /● meets both · ◐ meets modeled demand only · ✕ does not meet modeled demand/,
    );
  });

  it("keeps the ladder on the drawing when the all-simultaneous requirement is far beyond every package", async () => {
    const big = structuredClone(MOBILE_POWER_SAMPLE);
    big.totals.all_simultaneous_required_kw = 2000;
    stubApi(json(200, big));
    render(<Planner onBack={() => {}} />);
    calculate();
    await done();
    const ladder = screen.getByTestId("capacity-ladder");
    const band = ladder.querySelector(
      '[data-marker="simultaneity-band"]',
    ) as HTMLElement;
    expect(
      parseFloat(band.style.left) + parseFloat(band.style.width),
    ).toBeLessThanOrEqual(100.0001);
  });

  it("lets a load be chosen with the keyboard-operable toggle and shows its server details", async () => {
    stubApi(json(200, MOBILE_POWER_SAMPLE));
    render(<Planner onBack={() => {}} />);
    calculate();
    await done();
    expect(screen.queryByTestId("load-focus")).toBeNull();

    const welding = loadButton("Welding machines");
    expect(welding).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(welding);
    expect(welding).toHaveAttribute("aria-pressed", "true");
    const focus = within(
      screen.getByRole("region", { name: "Details for Welding machines" }),
    );
    expect(focus.getByText("3")).toBeVisible();
    expect(focus.getByText("12.00 kW")).toBeVisible();
    expect(focus.getByText("0.50")).toBeVisible();
    expect(focus.getByText("36.00 kW")).toBeVisible();
    expect(focus.getByText("18.00 kW")).toBeVisible();
    expect(focus.getByText("32.61%")).toBeVisible();
    expect(focus.getByText(/most modeled demand on the list/)).toBeVisible();

    fireEvent.click(loadButton("Cabin HVAC"));
    expect(welding).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(loadButton("Cabin HVAC"));
    expect(screen.queryByTestId("load-focus")).toBeNull();
    expect(
      screen.getByTestId("share-bar").querySelector("[data-slice]"),
    ).toHaveStyle({ opacity: "1" });
  });
});

describe("Mobile-Site Power Planner: stale results", () => {
  it("marks a result as outdated once any input changes and clears the notice when it is restored", async () => {
    stubApi(json(200, MOBILE_POWER_SAMPLE));
    render(<Planner onBack={() => {}} />);
    calculate();
    await done();
    expect(screen.queryByTestId("stale-notice")).toBeNull();

    fireEvent.change(input("Load 3 Simultaneity"), {
      target: { value: "0.60" },
    });
    expect(screen.getByTestId("stale-notice")).toHaveTextContent(
      /inputs changed after this result/,
    );
    expect(screen.getByTestId("stale-notice")).toHaveAttribute(
      "role",
      "status",
    );
    expect(screen.getByTestId("site-summary").parentElement).toHaveClass(
      "opacity-60",
    );

    fireEvent.change(input("Load 3 Simultaneity"), {
      target: { value: "0.50" },
    });
    expect(screen.queryByTestId("stale-notice")).toBeNull();
  });

  it.each([
    [
      "a name",
      () =>
        fireEvent.change(input("Load 1 Name"), { target: { value: "Lights" } }),
    ],
    [
      "a quantity",
      () =>
        fireEvent.change(input("Load 1 Quantity"), { target: { value: "9" } }),
    ],
    [
      "a rated power",
      () =>
        fireEvent.change(input("Load 1 Rated (kW)"), {
          target: { value: "0.5" },
        }),
    ],
    [
      "the margin",
      () =>
        fireEvent.change(input("Capacity margin"), { target: { value: "20" } }),
    ],
    [
      "an added load",
      () => fireEvent.click(screen.getByRole("button", { name: "Add load" })),
    ],
    [
      "a removed load",
      () =>
        fireEvent.click(screen.getByRole("button", { name: "Remove load 5" })),
    ],
  ])("flags the result as outdated after %s changes", async (_label, edit) => {
    stubApi(json(200, MOBILE_POWER_SAMPLE));
    render(<Planner onBack={() => {}} />);
    calculate();
    await done();
    edit();
    expect(screen.getByTestId("stale-notice")).toBeVisible();
  });

  it("clears the notice when the calculation is run again", async () => {
    stubApi(json(200, MOBILE_POWER_SAMPLE), json(200, MOBILE_POWER_SAMPLE));
    render(<Planner onBack={() => {}} />);
    calculate();
    await done();
    fireEvent.change(input("Capacity margin"), { target: { value: "20" } });
    expect(screen.getByTestId("stale-notice")).toBeVisible();
    calculate();
    await waitFor(() =>
      expect(screen.queryByTestId("stale-notice")).toBeNull(),
    );
  });

  it("keeps flagging an earlier result as outdated after a failed re-run", async () => {
    stubApi(
      json(200, MOBILE_POWER_SAMPLE),
      apiError(422, "VALIDATION_ERROR", [
        { field: "capacity_margin_pct", reason: "Must be between 0 and 50" },
      ]),
    );
    render(<Planner onBack={() => {}} />);
    calculate();
    await done();
    fireEvent.change(input("Capacity margin"), { target: { value: "90" } });
    calculate();
    expect(await screen.findByText("Must be between 0 and 50")).toBeVisible();
    expect(screen.getByTestId("site-summary")).toBeInTheDocument();
    expect(screen.getByTestId("stale-notice")).toBeVisible();
  });
});

describe("Mobile-Site Power Planner: editing", () => {
  it("adds, edits and removes loads within limits and sends exactly what is shown", async () => {
    const fn = stubApi(json(200, MOBILE_POWER_SAMPLE));
    render(<Planner onBack={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Add load" }));
    expect(loadGroups()).toHaveLength(6);
    fireEvent.change(input("Load 6 Name"), { target: { value: "Kettle" } });
    fireEvent.change(input("Load 6 Quantity"), { target: { value: "2" } });
    fireEvent.change(input("Load 6 Rated (kW)"), { target: { value: "3.5" } });
    fireEvent.change(input("Load 6 Simultaneity"), {
      target: { value: "0.4" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove load 1" }));
    expect(loadGroups()).toHaveLength(5);
    expect(input("Load 1 Name")).toHaveValue("Cabin HVAC");
    calculate();
    await done();
    expect(bodyOf(fn).loads.at(-1)).toEqual({
      name: "Kettle",
      quantity: 2,
      rated_kw: 3.5,
      simultaneity_factor: 0.4,
    });
    expect(bodyOf(fn).loads).toHaveLength(5);
  });

  it("limits the load count and keeps at least one load", () => {
    stubApi();
    render(<Planner onBack={() => {}} />);
    const add = screen.getByRole("button", { name: "Add load" });
    for (let i = 0; i < 7; i++) fireEvent.click(add);
    expect(loadGroups()).toHaveLength(12);
    expect(add).toBeDisabled();
    expect(screen.getByText("12 of 12 loads")).toBeInTheDocument();
    for (let i = 0; i < 11; i++)
      fireEvent.click(screen.getByRole("button", { name: "Remove load 1" }));
    expect(loadGroups()).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Remove load 1" }),
    ).toBeDisabled();
  });

  it("moves keyboard focus to the new load's name, then to a neighbour or the Add button after a removal", () => {
    stubApi();
    render(<Planner onBack={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Add load" }));
    expect(input("Load 6 Name")).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Remove load 2" }));
    // Load 3 (Welding machines) is now load 2.
    expect(input("Load 2 Name")).toHaveFocus();
    expect(input("Load 2 Name")).toHaveValue("Welding machines");

    // Removing the last load focuses the previous one.
    fireEvent.click(screen.getByRole("button", { name: "Remove load 5" }));
    expect(input("Load 4 Name")).toHaveFocus();
  });

  it("restores the sample values on request", () => {
    stubApi();
    render(<Planner onBack={() => {}} />);
    fireEvent.change(input("Load 3 Rated (kW)"), { target: { value: "99" } });
    fireEvent.change(input("Capacity margin"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Add load" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset to sample" }));
    expect(input("Load 3 Rated (kW)")).toHaveValue("12.00");
    expect(input("Capacity margin")).toHaveValue("25");
    expect(loadGroups()).toHaveLength(5);
  });

  it("starts a new load at quantity 1 and factor 1.00 with an empty name and power", () => {
    stubApi();
    render(<Planner onBack={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Add load" }));
    expect(input("Load 6 Name")).toHaveValue("");
    expect(input("Load 6 Quantity")).toHaveValue("1");
    expect(input("Load 6 Rated (kW)")).toHaveValue("");
    expect(input("Load 6 Simultaneity")).toHaveValue("1.00");
  });
});

describe("Mobile-Site Power Planner: list semantics", () => {
  it("keeps every load row inside a real list item", () => {
    stubApi();
    render(<Planner onBack={() => {}} />);
    const items = within(
      screen.getByRole("list", { name: "Loads" }),
    ).getAllByRole("listitem");
    expect(items).toHaveLength(5);
    for (const item of items)
      expect(within(item).getAllByRole("group")).toHaveLength(1);
  });
});

describe("Mobile-Site Power Planner: errors", () => {
  it("blocks non-numeric text locally without calling the API, and clears the message on edit", () => {
    const fn = stubApi();
    render(<Planner onBack={() => {}} />);
    fireEvent.change(input("Load 1 Quantity"), { target: { value: "abc" } });
    fireEvent.change(input("Load 3 Rated (kW)"), { target: { value: "" } });
    fireEvent.change(input("Load 4 Simultaneity"), { target: { value: "x" } });
    fireEvent.change(input("Capacity margin"), { target: { value: "y" } });
    calculate();
    expect(fn).not.toHaveBeenCalled();
    expect(screen.getAllByText("Enter a number.")).toHaveLength(4);
    expect(input("Load 1 Quantity")).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(input("Load 1 Quantity"), { target: { value: "8" } });
    expect(input("Load 1 Quantity")).toHaveAttribute("aria-invalid", "false");
    expect(screen.getAllByText("Enter a number.")).toHaveLength(3);
  });

  it("shows the server's field errors on the right inputs and keeps what was typed", async () => {
    stubApi(
      apiError(422, "VALIDATION_ERROR", [
        {
          field: "loads.1.rated_kw",
          reason: "Must be greater than 0 and at most 500",
        },
        {
          field: "loads.2.name",
          reason: "Must be different from the other load names",
        },
        {
          field: "loads.0.simultaneity_factor",
          reason: "Must be between 0.01 and 1.00",
        },
        { field: "capacity_margin_pct", reason: "Must be between 0 and 50" },
        {
          field: "loads",
          reason:
            "Total connected load must not exceed 2,000 kW; reduce quantities or rated power",
        },
      ]),
    );
    render(<Planner onBack={() => {}} />);
    fireEvent.change(input("Load 2 Rated (kW)"), { target: { value: "900" } });
    fireEvent.change(input("Capacity margin"), { target: { value: "60" } });
    calculate();
    expect(
      await screen.findByText("Check the highlighted inputs"),
    ).toBeVisible();
    for (const reason of [
      "Must be greater than 0 and at most 500",
      "Must be different from the other load names",
      "Must be between 0.01 and 1.00",
      "Must be between 0 and 50",
      /Total connected load must not exceed 2,000 kW/,
    ]) {
      expect(screen.getByText(reason)).toBeVisible();
    }
    expect(input("Load 2 Rated (kW)")).toHaveAttribute("aria-invalid", "true");
    expect(input("Load 3 Name")).toHaveAttribute("aria-invalid", "true");
    expect(input("Load 1 Simultaneity")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(input("Capacity margin")).toHaveAttribute("aria-invalid", "true");
    expect(input("Load 2 Rated (kW)")).toHaveValue("900");
    expect(
      screen.getByText("Must be between 0 and 50").closest("[role='alert']"),
    ).not.toBeNull();

    // A list-level error survives edits that cannot affect total connected load.
    fireEvent.change(input("Load 1 Name"), { target: { value: "Lights" } });
    expect(
      screen.getByText(/Total connected load must not exceed/),
    ).toBeVisible();

    // Editing a field clears the error that referred to its submitted value.
    fireEvent.change(input("Load 2 Rated (kW)"), { target: { value: "7.50" } });
    expect(
      screen.queryByText("Must be greater than 0 and at most 500"),
    ).toBeNull();
    fireEvent.change(input("Capacity margin"), { target: { value: "25" } });
    expect(screen.queryByText("Must be between 0 and 50")).toBeNull();
    // Changing a rating also cleared the list-level error: the total it described is gone.
    expect(
      screen.queryByText(/Total connected load must not exceed/),
    ).toBeNull();
  });

  it("links an input to its error message for assistive technology", async () => {
    stubApi(
      apiError(422, "VALIDATION_ERROR", [
        {
          field: "loads.0.rated_kw",
          reason: "Must be greater than 0 and at most 500",
        },
      ]),
    );
    render(<Planner onBack={() => {}} />);
    fireEvent.change(input("Load 1 Rated (kW)"), { target: { value: "0" } });
    calculate();
    const message = await screen.findByText(
      "Must be greater than 0 and at most 500",
    );
    const described =
      input("Load 1 Rated (kW)").getAttribute("aria-describedby");
    expect(described).toBe(message.id);
    expect(message).toHaveAttribute("role", "alert");
  });

  it("explains an unavailable API and retries with the same inputs", async () => {
    const fn = stubApi(
      apiError(503, "DATABASE_UNAVAILABLE"),
      json(200, MOBILE_POWER_SAMPLE),
    );
    render(<Planner onBack={() => {}} />);
    calculate();
    expect(
      await screen.findByText(/The GridProof API is unavailable/),
    ).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      /The calculation could not run/,
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await done();
    expect(fn).toHaveBeenCalledTimes(2);
    expect(bodyOf(fn, 1)).toEqual(bodyOf(fn, 0));
  });

  it("explains a 404 from a backend that does not serve the endpoint yet", async () => {
    stubApi(apiError(404, "NOT_FOUND"));
    render(<Planner onBack={() => {}} />);
    calculate();
    expect(
      await screen.findByText(/The calculation could not run/),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
  });
});

describe("Mobile-Site Power Planner: accessibility and isolation", () => {
  it("announces completion politely and never touches the session or configuration APIs", async () => {
    const fn = stubApi(json(200, MOBILE_POWER_SAMPLE));
    render(<Planner onBack={() => {}} />);
    calculate();
    await waitFor(() =>
      expect(
        screen.getByText(
          /Site demand calculated. Required capacity 69.00 kilowatts; all-simultaneous requirement 109.00 kilowatts. 2 of 4 synthetic packages meet modeled demand./,
        ),
      ).toBeInTheDocument(),
    );
    const live = screen
      .getAllByRole("status")
      .find((el) => el.textContent?.startsWith("Site demand calculated"));
    expect(live).toHaveClass("sr-only");
    const urls = fn.mock.calls.map(([u]) => String(u));
    expect(urls).toEqual(["/api/v1/demo/mobile-power"]);
    expect(urls.some((u) => /session|configurations/.test(u))).toBe(false);
  });

  it("labels every control, uses real buttons and a heading outline, and does not rely on colour alone", async () => {
    stubApi(json(200, MOBILE_POWER_SAMPLE));
    render(<Planner onBack={() => {}} />);
    calculate();
    await done();

    // Every text input has an accessible name.
    for (const box of screen.getAllByRole("textbox")) {
      expect(box).toHaveAccessibleName();
    }
    expect(
      screen.getByRole("form", { name: "Site loads" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Loads" })).toBeInTheDocument();
    // Headings: one h1, sections are h2, package names h3.
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
    ).toEqual(
      expect.arrayContaining([
        "Site loads",
        "Site demand",
        "Contribution by load",
        "Capacity ladder",
        "Synthetic packages",
        "How the calculations work",
      ]),
    );
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(4);
    // Each category and verdict carries a glyph AND words; the glyph is decorative.
    for (const badge of document.querySelectorAll("[data-category]")) {
      expect(badge.querySelector("[aria-hidden='true']")).not.toBeNull();
      expect(badge.textContent?.replace(/^\S+\s/, "").length).toBeGreaterThan(
        10,
      );
    }
    // The drawn ladder is hidden from assistive technology; text carries the same facts.
    const ladder = screen.getByTestId("capacity-ladder");
    expect(ladder.querySelector("[aria-hidden='true']")).not.toBeNull();
    expect(ladder.querySelector("figcaption")).toHaveTextContent(/Scale in kW/);
    expect(
      screen.getByRole("list", { name: "Ladder key" }),
    ).toBeInTheDocument();
    // Controls are native buttons.
    for (const name of [
      "Add load",
      "Reset to sample",
      "Calculate site demand",
    ]) {
      expect(screen.getByRole("button", { name }).tagName).toBe("BUTTON");
    }
  });

  it("respects reduced motion by using motion-safe transitions only", async () => {
    stubApi(json(200, MOBILE_POWER_SAMPLE));
    render(<Planner onBack={() => {}} />);
    calculate();
    await done();
    const slice = screen
      .getByTestId("share-bar")
      .querySelector("[data-slice]")!;
    expect(slice.className).toContain("motion-reduce:transition-none");
  });

  it("goes back to the map", () => {
    const onBack = vi.fn();
    stubApi();
    render(<Planner onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: /← Map/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

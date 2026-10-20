import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CAPACITY_CASE_1,
  CAPACITY_CASE_2,
  apiError,
  json,
} from "@/test/fixtures";
import Workbench from "./Workbench";

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
const run = () =>
  fireEvent.click(screen.getByRole("button", { name: "Run capacity check" }));

function pkg(letter: string) {
  return screen.getByRole("article", { name: `Synthetic Package ${letter}` });
}
function req(card: HTMLElement, id: "KW_CAPACITY" | "KVA_CAPACITY") {
  return card.querySelector(`[data-requirement="${id}"]`) as HTMLElement;
}

describe("Daventry workbench", () => {
  it("opens with example inputs, no network call and clear synthetic labeling", () => {
    const fn = stubApi();
    render(<Workbench onBack={() => {}} />);
    expect(fn).not.toHaveBeenCalled();
    expect(input("Real power demand")).toHaveValue("400");
    expect(input("Power factor")).toHaveValue("0.8");
    expect(input(/Capacity margin/)).toHaveValue("0");
    expect(
      screen.getByRole("heading", {
        name: "Daventry Generator Configuration Workbench",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Synthetic")).toBeInTheDocument();
    expect(screen.getByText(/independent of the plant/)).toBeInTheDocument();
    expect(
      screen.getByText(/Not a product recommendation, plant operation/),
    ).toBeInTheDocument();
    const image = screen.getByRole("img", { name: /four synthetic enclosed/ });
    expect(image).toHaveAttribute(
      "src",
      "/illustrations/daventry-package-lineup.svg",
    );
    expect(screen.getByText(/No result yet/)).toBeInTheDocument();
  });

  it("sends the inputs to the stateless endpoint and shows separate verdicts from the response", async () => {
    const fn = stubApi(json(200, CAPACITY_CASE_1));
    render(<Workbench onBack={() => {}} />);
    run();
    await screen.findByTestId("demand-summary");

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0][0]).toBe("/api/v1/demo/capacity-check");
    expect(fn.mock.calls[0][1]?.method).toBe("POST");
    expect(bodyOf(fn)).toEqual({
      real_power_kw: 400,
      power_factor: 0.8,
      capacity_margin_pct: 0,
    });

    const summary = screen.getByTestId("demand-summary");
    // Apparent power and required kVA are both 500.00 kVA with no margin.
    expect(within(summary).getAllByText("500.00 kVA")).toHaveLength(2);
    expect(within(summary).getAllByText("400.00 kW").length).toBe(2);

    for (const letter of ["A", "B", "C", "D"])
      expect(pkg(letter)).toBeVisible();
    const expected = {
      A: ["fail", "fail"],
      B: ["fail", "fail"],
      C: ["pass", "pass"],
      D: ["pass", "pass"],
    } as const;
    for (const [letter, [kw, kva]] of Object.entries(expected)) {
      expect(req(pkg(letter), "KW_CAPACITY")).toHaveAttribute(
        "data-status",
        kw,
      );
      expect(req(pkg(letter), "KVA_CAPACITY")).toHaveAttribute(
        "data-status",
        kva,
      );
    }
    const c = req(pkg("C"), "KW_CAPACITY");
    expect(within(c).getByText("PASS")).toBeVisible();
    expect(within(c).getByText("+80.00 kW")).toBeVisible();
    expect(within(c).getByText("+20.00% of required")).toBeVisible();
    // Server explanations sit in a collapsed disclosure, still in the DOM.
    const explanation = within(pkg("C")).getByText(
      /Backend explanation: required 400.00 kW/,
    );
    expect(explanation).not.toBeVisible();
    fireEvent.click(within(pkg("C")).getByText("Server explanations"));
    expect(explanation).toBeVisible();
    const a = req(pkg("A"), "KVA_CAPACITY");
    expect(within(a).getByText("FAIL")).toBeVisible();
    expect(within(a).getByText("−250.00 kVA")).toBeVisible();
    expect(screen.getByText(/Backend assumption one/)).toBeInTheDocument();
  });

  it("shows a split kW pass with a kVA fail for the same package, with no overall verdict or ranking", async () => {
    stubApi(json(200, CAPACITY_CASE_2));
    render(<Workbench onBack={() => {}} />);
    fireEvent.change(input("Real power demand"), { target: { value: "300" } });
    fireEvent.change(input("Power factor"), { target: { value: "0.70" } });
    run();
    await screen.findByTestId("demand-summary");

    const b = pkg("B");
    expect(within(req(b, "KW_CAPACITY")).getByText("PASS")).toBeVisible();
    expect(within(req(b, "KVA_CAPACITY")).getByText("FAIL")).toBeVisible();
    expect(
      within(req(b, "KVA_CAPACITY")).getByText("−28.57 kVA"),
    ).toBeVisible();
    expect(
      within(screen.getByTestId("demand-summary")).getAllByText("428.57 kVA"),
    ).toHaveLength(2);

    const results = screen.getByRole("region", {
      name: "Capacity check results",
    });
    expect(results.textContent).not.toMatch(
      /overall|winner|best|ideal|suitable|recommended|selected package/i,
    );
  });

  it("renders the verdict the server returned and never recalculates it", async () => {
    const lie = structuredClone(CAPACITY_CASE_1);
    const first = lie.packages[0].requirements[0];
    first.status = "pass"; // contradicts its own numbers on purpose
    first.required = 999;
    first.capacity = 1;
    stubApi(json(200, lie));
    render(<Workbench onBack={() => {}} />);
    run();
    await screen.findByTestId("demand-summary");
    const row = req(pkg("A"), "KW_CAPACITY");
    expect(row).toHaveAttribute("data-status", "pass");
    expect(within(row).getByText("PASS")).toBeVisible();
    expect(within(row).getByText("999.00 kW")).toBeVisible();
  });

  it("summarises how many packages pass both requirements, from the separate verdicts", async () => {
    stubApi(json(200, CAPACITY_CASE_2));
    render(<Workbench onBack={() => {}} />);
    run();
    const summary = await screen.findByTestId("screening-summary");
    // Hand count of CAPACITY_CASE_2: C and D pass both; B, C, D pass kW; C, D pass kVA.
    expect(summary).toHaveTextContent("2 of 4");
    expect(summary).toHaveTextContent("kW requirement: 3 of 4 pass");
    expect(summary).toHaveTextContent("kVA requirement: 2 of 4 pass");
    expect(summary).not.toHaveTextContent(/recommend|best|rank/i);
  });

  it("draws kW and kVA bars on one shared scale per unit without altering verdicts", async () => {
    stubApi(json(200, CAPACITY_CASE_1));
    render(<Workbench onBack={() => {}} />);
    run();
    await screen.findByTestId("screening-summary");
    const widthOf = (letter: string, id: "KW_CAPACITY" | "KVA_CAPACITY") =>
      (req(pkg(letter), id).querySelector('[data-bar="rated"]') as HTMLElement)
        .style.width;
    const markerOf = (letter: string, id: "KW_CAPACITY" | "KVA_CAPACITY") =>
      (
        req(pkg(letter), id).querySelector(
          '[data-bar="required"]',
        ) as HTMLElement
      ).style.left;
    // kW: required 400, ratings 200/320/480/640 -> shared scale 0..640.
    expect(widthOf("A", "KW_CAPACITY")).toBe(`${(200 / 640) * 100}%`);
    expect(markerOf("A", "KW_CAPACITY")).toBe(`${(400 / 640) * 100}%`);
    expect(markerOf("D", "KW_CAPACITY")).toBe(markerOf("A", "KW_CAPACITY"));
    expect(widthOf("D", "KW_CAPACITY")).toBe("100%");
    expect(
      screen.getByText(/All kW bars share one scale \(0 to 640.00 kW\)/),
    ).toBeVisible();
    // Exact values and margins remain printed as text.
    expect(
      within(req(pkg("C"), "KW_CAPACITY")).getByText("+80.00 kW"),
    ).toBeVisible();
    expect(req(pkg("A"), "KW_CAPACITY")).toHaveAttribute("data-status", "fail");
  });

  it("lets a package be inspected and cleared with the keyboard-operable toggle", async () => {
    stubApi(json(200, CAPACITY_CASE_1));
    render(<Workbench onBack={() => {}} />);
    run();
    await screen.findByTestId("screening-summary");
    expect(screen.queryByTestId("lineup-highlight")).toBeNull();
    expect(screen.queryByTestId("package-focus")).toBeNull();

    const toggle = screen.getByRole("button", {
      name: "Inspect Synthetic Package C",
    });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("lineup-highlight")).toBeInTheDocument();
    const focus = screen.getByRole("region", {
      name: "Details for Synthetic Package C",
    });
    expect(
      within(focus).getByText(/Backend explanation: required 400.00 kW/),
    ).toBeVisible();

    // Selecting another package moves the focus; selecting it again clears it.
    fireEvent.click(
      screen.getByRole("button", { name: "Inspect Synthetic Package A" }),
    );
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(
      screen.getByRole("button", { name: "Inspect Synthetic Package A" }),
    );
    expect(screen.queryByTestId("package-focus")).toBeNull();
    expect(screen.queryByTestId("lineup-highlight")).toBeNull();
  });

  it("omits a blank optional margin from the request", async () => {
    const fn = stubApi(json(200, CAPACITY_CASE_1));
    render(<Workbench onBack={() => {}} />);
    fireEvent.change(input(/Capacity margin/), { target: { value: "  " } });
    run();
    await screen.findByTestId("demand-summary");
    expect(bodyOf(fn)).toEqual({ real_power_kw: 400, power_factor: 0.8 });
  });

  it("sends a margin and a power factor of exactly 1 as typed", async () => {
    const fn = stubApi(json(200, CAPACITY_CASE_1));
    render(<Workbench onBack={() => {}} />);
    fireEvent.change(input("Power factor"), { target: { value: "1" } });
    fireEvent.change(input(/Capacity margin/), { target: { value: "20" } });
    run();
    await screen.findByTestId("demand-summary");
    expect(bodyOf(fn)).toEqual({
      real_power_kw: 400,
      power_factor: 1,
      capacity_margin_pct: 20,
    });
  });

  it("blocks non-numeric text locally without calling the API", () => {
    const fn = stubApi();
    render(<Workbench onBack={() => {}} />);
    fireEvent.change(input("Real power demand"), { target: { value: "abc" } });
    fireEvent.change(input("Power factor"), { target: { value: "" } });
    run();
    expect(fn).not.toHaveBeenCalled();
    expect(screen.getAllByText("Enter a number.")).toHaveLength(2);
    expect(input("Real power demand")).toHaveAttribute("aria-invalid", "true");
  });

  it("shows the server's field error and keeps what was typed", async () => {
    stubApi(
      apiError(422, "VALIDATION_ERROR", [
        { field: "power_factor", reason: "Must be between 0.50 and 1.00" },
      ]),
    );
    render(<Workbench onBack={() => {}} />);
    fireEvent.change(input("Power factor"), { target: { value: "0.3" } });
    run();
    expect(
      await screen.findByText("Must be between 0.50 and 1.00"),
    ).toBeVisible();
    expect(input("Power factor")).toHaveValue("0.3");
    expect(input("Power factor")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Check the highlighted inputs")).toBeVisible();
    // Editing the field clears its server error.
    fireEvent.change(input("Power factor"), { target: { value: "0.8" } });
    expect(screen.queryByText("Must be between 0.50 and 1.00")).toBeNull();
  });

  it("explains an unavailable API and retries with the same inputs", async () => {
    const fn = stubApi(
      apiError(503, "DATABASE_UNAVAILABLE"),
      json(200, CAPACITY_CASE_1),
    );
    render(<Workbench onBack={() => {}} />);
    run();
    expect(
      await screen.findByText(/The GridProof API is unavailable/),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByTestId("demand-summary");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(bodyOf(fn, 1)).toEqual(bodyOf(fn, 0));
  });

  it("marks a result as outdated once an input changes", async () => {
    stubApi(json(200, CAPACITY_CASE_1));
    render(<Workbench onBack={() => {}} />);
    run();
    await screen.findByTestId("demand-summary");
    expect(screen.queryByText(/inputs changed after this result/)).toBeNull();
    fireEvent.change(input("Real power demand"), { target: { value: "401" } });
    expect(screen.getByText(/inputs changed after this result/)).toBeVisible();
  });

  it("announces completion politely and never touches the session or configuration APIs", async () => {
    const fn = stubApi(json(200, CAPACITY_CASE_1));
    render(<Workbench onBack={() => {}} />);
    run();
    await waitFor(() =>
      expect(
        screen.getByText(
          /Capacity check complete for 400 kW at 0.8 power factor/,
        ),
      ).toBeInTheDocument(),
    );
    const urls = fn.mock.calls.map(([u]) => String(u));
    expect(urls).toEqual(["/api/v1/demo/capacity-check"]);
    expect(urls.some((u) => /session|configurations/.test(u))).toBe(false);
  });

  it("goes back to the map", () => {
    const onBack = vi.fn();
    stubApi();
    render(<Workbench onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: /← Map/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("makes no capability claims beyond what exists", () => {
    stubApi();
    const { container } = render(<Workbench onBack={() => {}} />);
    const text = (container.textContent ?? "").toLowerCase();
    for (const banned of [
      "certified",
      "compliant",
      "guarantee",
      "official",
      "best match",
      "we recommend",
    ]) {
      expect(text).not.toContain(banned);
    }
  });
});

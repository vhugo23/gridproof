import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RECORDED_STARTUP_CHECK } from "@/lib/recorded";
import { apiError, current, facilities, json } from "@/test/fixtures";
import AppShell from "../AppShell";

const { baseline, modified } = RECORDED_STARTUP_CHECK;

beforeEach(() => {
  window.location.hash = "";
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: true,
      addEventListener() {},
      removeEventListener() {},
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

type CheckHandler = (version: number) => Response;

function stubApi(options: {
  latestVersion: number;
  check?: CheckHandler;
  facilitiesDown?: boolean;
  currentDown?: boolean;
}) {
  const check: CheckHandler =
    options.check ??
    ((version) =>
      version === 1
        ? json(200, baseline)
        : version === 2
          ? json(200, modified)
          : apiError(404, "CONFIGURATION_NOT_FOUND"));
  const fn = vi.fn((url: string, init?: RequestInit) => {
    if (url.endsWith("/facilities"))
      return Promise.resolve(
        options.facilitiesDown
          ? apiError(503, "CATALOG_UNAVAILABLE")
          : json(200, { catalog_version: 1, facilities }),
      );
    if (url.endsWith("/configurations/current"))
      return Promise.resolve(
        options.currentDown
          ? apiError(503, "DATABASE_UNAVAILABLE")
          : json(
              200,
              current(
                options.latestVersion,
                options.latestVersion > 1 ? 15 : 5,
              ),
            ),
      );
    if (url.endsWith("/demo/startup-check")) {
      const body = JSON.parse(String(init?.body));
      return Promise.resolve(check(body.version_number));
    }
    return Promise.resolve(apiError(404, "NOT_FOUND"));
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const checkCalls = (fn: ReturnType<typeof stubApi>) =>
  fn.mock.calls
    .filter(([u]) => String(u).endsWith("/demo/startup-check"))
    .map(([, i]) => JSON.parse(String(i?.body)));

async function openLab() {
  fireEvent.click(
    await screen.findByRole("button", { name: /Enter Virtual Lab/ }),
  );
  await screen.findByRole("button", { name: /Generator G1/ });
}

const runButton = () =>
  screen.getByRole("button", { name: /Run Utility-Outage Test/ });

describe("utility-outage comparison", () => {
  it("runs baseline v1 and the latest version and shows the returned evidence", async () => {
    const fetchMock = stubApi({ latestVersion: 2 });
    render(<AppShell />);
    await openLab();
    await waitFor(() => expect(runButton()).toBeEnabled());
    fireEvent.click(runButton());

    const baselineCard = await screen.findByRole("article", {
      name: "Baseline · v1",
    });
    const modifiedCard = screen.getByRole("article", { name: "Modified · v2" });
    expect(
      checkCalls(fetchMock)
        .map((c) => c.version_number)
        .sort(),
    ).toEqual([1, 2]);
    expect(checkCalls(fetchMock)[0]).toEqual({
      configuration_id: current().configuration_id,
      version_number: expect.any(Number),
    });

    const ready = (card: HTMLElement) =>
      card.querySelector('[data-requirement="G1_READY_WITHIN_10S"]')!;
    const continuity = (card: HTMLElement) =>
      card.querySelector('[data-requirement="CRITICAL_LOAD_CONTINUITY"]')!;
    expect(ready(baselineCard)).toHaveAttribute("data-status", "pass");
    expect(ready(modifiedCard)).toHaveAttribute("data-status", "fail");
    expect(continuity(baselineCard)).toHaveAttribute("data-status", "pass");
    expect(continuity(modifiedCard)).toHaveAttribute("data-status", "pass");
    expect(
      within(ready(baselineCard) as HTMLElement).getByText("PASS"),
    ).toBeVisible();
    expect(
      within(ready(modifiedCard) as HTMLElement).getByText("FAIL"),
    ).toBeVisible();
    expect(
      within(ready(modifiedCard) as HTMLElement).getByText(
        /Ready 15 s after the outage · limit 10 s/,
      ),
    ).toBeVisible();

    // Metrics are the backend's, displayed as returned.
    expect(within(baselineCard).getByText("0.25 kWh")).toBeVisible();
    expect(within(modifiedCard).getByText("0.75 kWh")).toBeVisible();
    expect(within(baselineCard).getByText("G1 startup 5 s")).toBeVisible();
    expect(within(modifiedCard).getByText("G1 startup 15 s")).toBeVisible();
    expect(document.querySelector('[data-mode="live"]')).not.toBeNull();
    expect(document.querySelector('[data-mode="recorded"]')).toBeNull();
  });

  it("lists the simulator's own assumptions and its event timeline", async () => {
    stubApi({ latestVersion: 2 });
    render(<AppShell />);
    await openLab();
    await waitFor(() => expect(runButton()).toBeEnabled());
    fireEvent.click(runButton());
    await screen.findByRole("article", { name: "Modified · v2" });

    const drawer = screen.getByText(/Simulation assumptions \(13\)/);
    expect(drawer).toBeInTheDocument();
    for (const a of baseline.assumptions) {
      expect(screen.getByText(a.text)).toBeInTheDocument();
    }
    for (const e of modified.events) {
      expect(screen.getAllByText(e.description).length).toBeGreaterThan(0);
    }
    expect(
      screen.getByRole("img", { name: /Event timeline/ }),
    ).toBeInTheDocument();
  });

  it("requires a saved configuration with no unsaved edits", async () => {
    const fetchMock = stubApi({ latestVersion: 2 });
    render(<AppShell />);
    await openLab();
    await waitFor(() => expect(runButton()).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: /Generator G1/ }));
    fireEvent.change(screen.getByLabelText("Startup delay"), {
      target: { value: "9" },
    });
    expect(runButton()).toBeDisabled();
    expect(screen.getByText(/Save or discard your edits first/)).toBeVisible();
    fireEvent.click(runButton());
    expect(checkCalls(fetchMock)).toHaveLength(0);
  });

  it("explains instead of inventing a difference when only version 1 exists", async () => {
    const fetchMock = stubApi({ latestVersion: 1 });
    render(<AppShell />);
    await openLab();
    await waitFor(() => expect(runButton()).toBeEnabled());
    fireEvent.click(runButton());

    expect(
      await screen.findByText(
        /baseline and your current configuration are the same saved version/,
      ),
    ).toBeVisible();
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(
      screen.getByRole("article", { name: /Baseline · v1 \(current\)/ }),
    ).toBeVisible();
    expect(checkCalls(fetchMock)).toEqual([
      { configuration_id: current().configuration_id, version_number: 1 },
    ]);
    expect(screen.queryByRole("article", { name: /Modified/ })).toBeNull();
  });

  it("labels results as out of date after a newer version is saved", async () => {
    let latest = current(1, 5);
    const fn = vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith("/facilities"))
        return Promise.resolve(json(200, { catalog_version: 1, facilities }));
      if (url.endsWith("/configurations/current"))
        return Promise.resolve(json(200, latest));
      if (url.endsWith("/demo/startup-check"))
        return Promise.resolve(json(200, baseline));
      if (init?.method === "POST" && url.includes("/versions")) {
        const sent = JSON.parse(String(init.body));
        latest = current(2, sent.snapshot.equipment.g1.startup_delay_s);
        return Promise.resolve(
          json(201, {
            configuration_id: latest.configuration_id,
            version_id: latest.version_id,
            version_number: 2,
            schema_version: "config-v1",
            saved_at: latest.saved_at,
          }),
        );
      }
      return Promise.resolve(apiError(404, "NOT_FOUND"));
    });
    vi.stubGlobal("fetch", fn);
    render(<AppShell />);
    await openLab();
    await waitFor(() => expect(runButton()).toBeEnabled());
    fireEvent.click(runButton());
    await screen.findByText(/same saved version/);
    expect(screen.queryByText(/Run the test again/)).toBeNull();

    // Save version 2: the displayed v1-only result is now older than the latest.
    fireEvent.click(screen.getByRole("button", { name: /Generator G1/ }));
    fireEvent.change(screen.getByLabelText("Startup delay"), {
      target: { value: "15" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Save as new version/ }),
    );
    await screen.findByText("Saved and confirmed from the server.");
    fireEvent.click(screen.getByRole("tab", { name: /Test results/ }));
    expect(
      await screen.findByText(
        /latest saved version is v2\. Run the test again/,
      ),
    ).toBeVisible();
  });
});

describe("playback uses the returned frames only", () => {
  it("shows each evidence frame in the lab without recomputing anything", async () => {
    stubApi({ latestVersion: 2 });
    render(<AppShell />);
    await openLab();
    await waitFor(() => expect(runButton()).toBeEnabled());
    fireEvent.click(runButton());
    await screen.findByRole("article", { name: "Modified · v2" });

    const slider = screen.getByLabelText("Evidence frame");
    const frames = modified.frames;
    expect(slider).toHaveAttribute("max", String(frames.length - 1));

    fireEvent.pointerDown(slider); // grabbing the slider shows frame 1
    for (const [i, frame] of frames.entries()) {
      fireEvent.change(slider, { target: { value: String(i) } });
      const event = modified.events.find((e) => e.id === frame.event_id)!;
      expect(screen.getByTestId("frame-caption")).toHaveTextContent(
        `Frame ${i + 1} of ${frames.length}`,
      );
      expect(screen.getByTestId("frame-caption")).toHaveTextContent(
        event.description,
      );
      const battery = screen.getByRole("button", { name: /Battery Storage/ });
      expect(battery).toHaveAttribute(
        "aria-label",
        `Battery Storage: ${frame.battery_soc_pct}% SoC · ${frame.power_kw.battery_kw} kW`,
      );
      const g1 = screen.getByRole("button", { name: /Generator G1/ });
      expect(g1).toHaveAttribute(
        "aria-label",
        `Generator G1: ${frame.power_kw.g1_kw} kW`,
      );
      const flow = document.querySelector('[data-path="g1"]')!;
      expect(flow.getAttribute("data-active")).toBe(
        String(frame.power_kw.g1_kw > 0),
      );
    }

    // The frame after G1 transfer: G1 carries the load, the battery stops.
    const online = frames.findIndex((f) => f.states.g1 === "online");
    fireEvent.change(slider, { target: { value: String(online) } });
    expect(screen.getByText(/G1 · ONLINE/)).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Show configured view" }),
    );
    expect(screen.queryByText(/G1 · ONLINE/)).toBeNull();
    expect(
      screen.getByRole("button", { name: /Generator G1: 15 s start · 250 kW/ }),
    ).toBeInTheDocument();
  });

  it("switching between baseline and modified plays the matching evidence", async () => {
    stubApi({ latestVersion: 2 });
    render(<AppShell />);
    await openLab();
    await waitFor(() => expect(runButton()).toBeEnabled());
    fireEvent.click(runButton());
    await screen.findByRole("article", { name: "Modified · v2" });

    fireEvent.click(screen.getByRole("button", { name: "Baseline" }));
    const slider = screen.getByLabelText("Evidence frame");
    const index = baseline.frames.findIndex((f) => f.states.g1 === "ready");
    fireEvent.change(slider, { target: { value: String(index) } });
    expect(screen.getByTestId("frame-caption")).toHaveTextContent("5 s");
    expect(screen.getByText(/G1 · READY/)).toBeInTheDocument();
  });
});

describe("recorded demo fallback", () => {
  it("is clearly labeled as recorded, uses no backend test call and never says live", async () => {
    const fetchMock = stubApi({ latestVersion: 2 });
    render(<AppShell />);
    await openLab();
    fireEvent.click(screen.getByRole("button", { name: "Show recorded demo" }));

    expect(
      await screen.findByText(/RECORDED DEMO · NOT A LIVE RUN/),
    ).toBeVisible();
    expect(document.querySelector('[data-mode="live"]')).toBeNull();
    expect(screen.queryByText(/LIVE · SIMULATED/)).toBeNull();
    expect(checkCalls(fetchMock)).toHaveLength(0);
    expect(
      screen.getByRole("article", { name: "Baseline · v1" }),
    ).toBeVisible();
    expect(
      screen
        .getByRole("article", { name: "Modified · v2" })
        .querySelector('[data-requirement="G1_READY_WITHIN_10S"]'),
    ).toHaveAttribute("data-status", "fail");

    fireEvent.change(screen.getByLabelText("Evidence frame"), {
      target: { value: "2" },
    });
    expect(screen.getByText(/RECORDED DEMO PLAYBACK/)).toBeInTheDocument();
  });

  it("is available even when the backend is down", async () => {
    stubApi({ latestVersion: 2, currentDown: true });
    render(<AppShell />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Enter Virtual Lab/ }),
    );
    await screen.findByText("Could not load the lab configuration");
    expect(runButton()).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Show recorded demo" }));
    expect(
      await screen.findByText(/RECORDED DEMO · NOT A LIVE RUN/),
    ).toBeVisible();
  });
});

describe("failures are safe", () => {
  const cases: Array<[string, Response, string]> = [
    ["401", apiError(401, "WORKSPACE_EXPIRED"), "session"],
    ["403", apiError(403, "FORBIDDEN"), "forbidden"],
    ["404", apiError(404, "CONFIGURATION_NOT_FOUND"), "not_found"],
    ["500", apiError(500, "INTERNAL_ERROR"), "internal"],
    ["503", apiError(503, "DATABASE_UNAVAILABLE"), "unavailable"],
  ];

  it.each(cases)(
    "%s shows a clear error and leaves the configuration and draft alone",
    async (_label, response, kind) => {
      const fetchMock = stubApi({
        latestVersion: 2,
        check: () => response.clone(),
      });
      render(<AppShell />);
      await openLab();
      await waitFor(() => expect(runButton()).toBeEnabled());
      fireEvent.click(runButton());

      const alert = await screen.findByText("The live test could not run");
      expect(alert.closest("[role=alert]")).toHaveAttribute(
        "data-error-kind",
        kind,
      );
      expect(document.querySelector('[data-mode="live"]')).toBeNull();

      // No session recovery or configuration writes happened, and edits still work.
      const urls = fetchMock.mock.calls.map(([u]) => String(u));
      expect(urls.some((u) => u.endsWith("/session"))).toBe(false);
      expect(
        fetchMock.mock.calls.some(
          ([, i]) =>
            i?.method === "POST" && String(i.body).includes("snapshot"),
        ),
      ).toBe(false);
      fireEvent.click(screen.getByRole("button", { name: /Generator G1/ }));
      fireEvent.change(screen.getByLabelText("Startup delay"), {
        target: { value: "9" },
      });
      expect(screen.getByLabelText("Startup delay")).toHaveValue("9");
      expect(screen.getByText("Unsaved changes.")).toBeInTheDocument();

      // The recorded demo is still offered from the results tab, separately labeled.
      fireEvent.click(screen.getByRole("tab", { name: /Test results/ }));
      expect(
        screen.getByRole("button", { name: "Show recorded demo instead" }),
      ).toBeVisible();
    },
  );

  it("a network failure is reported as unavailable", async () => {
    stubApi({
      latestVersion: 2,
      check: () => {
        throw new TypeError("offline");
      },
    });
    render(<AppShell />);
    await openLab();
    await waitFor(() => expect(runButton()).toBeEnabled());
    fireEvent.click(runButton());
    expect(
      await screen.findByText("The live test could not run"),
    ).toBeVisible();
  });
});

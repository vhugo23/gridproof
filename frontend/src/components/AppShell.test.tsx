import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CAPACITY_CASE_1,
  DUTY_CYCLE_SAMPLE,
  MOBILE_POWER_SAMPLE,
  apiError,
  current,
  facilities,
  json,
} from "@/test/fixtures";
import { ENGINE_PLAN_SAMPLE } from "@/test/enginePlanFixture";
import AppShell from "./AppShell";

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

function stubApi(onSave?: (body: unknown) => Response) {
  let latest = current(1, 5);
  const fn = vi.fn((url: string, init?: RequestInit) => {
    if (url.endsWith("/facilities"))
      return Promise.resolve(json(200, { catalog_version: 1, facilities }));
    if (url.endsWith("/configurations/current"))
      return Promise.resolve(json(200, latest));
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      if (onSave) return Promise.resolve(onSave(body));
      latest = current(2, body.snapshot.equipment.g1.startup_delay_s);
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
  return fn;
}

describe("map -> lab -> G1 -> save flow", () => {
  it("shows three markers but only Fridley can enter the lab", async () => {
    stubApi();
    render(<AppShell />);
    expect(
      await screen.findByRole("button", { name: /Fridley/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Seymour/ })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Daventry/ }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /Enter Virtual Lab/ }),
    ).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: /Seymour/ }));
    expect(
      screen.queryByRole("button", { name: /Enter Virtual Lab/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Open Test-Plan Workbench/ }),
    ).toBeInTheDocument();
  });

  it("does not create a session until the lab is opened", async () => {
    const fetchMock = stubApi();
    render(<AppShell />);
    await screen.findByRole("button", { name: /Fridley/ });
    expect(
      fetchMock.mock.calls.some(([u]) => String(u).includes("configurations")),
    ).toBe(false);
  });

  it("changes G1 from 5 to 15 s, saves v2 and confirms it from the server", async () => {
    const fetchMock = stubApi();
    render(<AppShell />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Enter Virtual Lab/ }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /Generator G1/ }),
    );

    const delay = screen.getByLabelText("Startup delay");
    expect(delay).toHaveValue("5");
    expect(
      screen.getByRole("button", { name: /Save as new version/ }),
    ).toBeDisabled();

    fireEvent.change(delay, { target: { value: "15" } });
    expect(screen.getByText("Unsaved changes.")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /Save as new version/ }),
    );

    expect(
      await screen.findByText("Saved and confirmed from the server."),
    ).toBeInTheDocument();
    const post = fetchMock.mock.calls.find(([, i]) => i?.method === "POST")!;
    const sent = JSON.parse(String(post[1]!.body));
    expect(sent.expected_version).toBe(1);
    expect(sent.snapshot.equipment.g1.startup_delay_s).toBe(15);
    expect(screen.getAllByText(/v2/).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Startup delay")).toHaveValue("15");
  });

  it("keeps the typed value and shows the server's field error on 422", async () => {
    stubApi(() =>
      apiError(422, "VALIDATION_ERROR", [
        {
          field: "snapshot.equipment.g1.startup_delay_s",
          reason: "Must be between 0 and 120",
        },
      ]),
    );
    render(<AppShell />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Enter Virtual Lab/ }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /Generator G1/ }),
    );
    const delay = screen.getByLabelText("Startup delay");
    fireEvent.change(delay, { target: { value: "121" } });
    fireEvent.click(
      screen.getByRole("button", { name: /Save as new version/ }),
    );

    await waitFor(() =>
      expect(screen.getByText("Must be between 0 and 120")).toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Startup delay")).toHaveValue("121");
  });

  it("shows an outage state with Retry when the configuration cannot load", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve(
          url.endsWith("/facilities")
            ? json(200, { catalog_version: 1, facilities })
            : apiError(503, "DATABASE_UNAVAILABLE"),
        ),
      ),
    );
    render(<AppShell />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Enter Virtual Lab/ }),
    );
    expect(
      await screen.findByText("Could not load the lab configuration"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});

describe("Industry Applications -> lab", () => {
  it.each([
    [
      "Power generation",
      /Start the G1 startup challenge in the Fridley lab/,
      "Generator G1",
    ],
    [
      "Battery storage and switchgear",
      /Start the battery continuity challenge in the Fridley lab/,
      "Battery Storage",
    ],
  ])(
    "%s opens the lab with the right equipment selected",
    async (title, action, heading) => {
      stubApi();
      render(<AppShell />);
      fireEvent.click(
        await screen.findByRole("button", { name: new RegExp(title) }),
      );
      fireEvent.click(screen.getByRole("button", { name: action }));
      expect(
        await screen.findByRole("heading", { name: heading }),
      ).toBeInTheDocument();
      expect(window.location.hash).toBe("#fridley-lab");
    },
  );

  it("opens the lab with nothing selected from the motors brief", async () => {
    stubApi();
    render(<AppShell />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Motors and electrical/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Open the Fridley lab/ }),
    );
    expect(await screen.findByText("Select equipment")).toBeInTheDocument();
  });
});

describe("Industry Applications -> Mining duty-cycle analyzer", () => {
  function stubMiningApi() {
    const fn = vi.fn((url: string) => {
      if (url.endsWith("/facilities"))
        return Promise.resolve(json(200, { catalog_version: 1, facilities }));
      if (url.endsWith("/demo/duty-cycle"))
        return Promise.resolve(json(200, DUTY_CYCLE_SAMPLE));
      return Promise.resolve(apiError(404, "NOT_FOUND"));
    });
    vi.stubGlobal("fetch", fn);
    return fn;
  }
  const urls = (fn: ReturnType<typeof stubMiningApi>) =>
    fn.mock.calls.map(([u]) => String(u));

  it("opens from the Mining brief by hash, analyzes without any session call and returns to the map", async () => {
    const fn = stubMiningApi();
    render(<AppShell />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Mining and off-highway/ }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: /Open the Duty-Cycle Energy Analyzer/,
      }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "Mining Duty-Cycle Energy Analyzer",
      }),
    ).toBeInTheDocument();
    expect(window.location.hash).toBe("#mining-duty-cycle");

    fireEvent.click(screen.getByRole("button", { name: "Analyze duty cycle" }));
    expect(await screen.findByTestId("cycle-summary")).toBeInTheDocument();
    expect(urls(fn)).toContain("/api/v1/demo/duty-cycle");
    expect(urls(fn).some((u) => /session|configurations/.test(u))).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /← Map/ }));
    await waitFor(() => expect(window.location.hash).toBe(""));
    expect(
      await screen.findByRole("heading", { name: "Explore Power Integration" }),
    ).toBeInTheDocument();
    expect(urls(fn).some((u) => /session|configurations/.test(u))).toBe(false);
  });

  it("opens directly from its address and is not a map facility", async () => {
    window.location.hash = "#mining-duty-cycle";
    const fn = stubMiningApi();
    render(<AppShell />);
    expect(
      await screen.findByRole("heading", {
        name: "Mining Duty-Cycle Energy Analyzer",
      }),
    ).toBeInTheDocument();
    expect(urls(fn).some((u) => /session|configurations/.test(u))).toBe(false);
    window.location.hash = "";
    await screen.findByRole("heading", { name: "Explore Power Integration" });
    expect(
      screen.queryByRole("button", { name: /Mining.*facility/i }),
    ).toBeNull();
    expect(facilities.map((f) => f.id)).toEqual(
      expect.not.arrayContaining(["mining"]),
    );
  });
});

describe("Industry Applications -> Mobile-Site Power Planner", () => {
  function stubMobileApi() {
    const fn = vi.fn((url: string) => {
      if (url.endsWith("/facilities"))
        return Promise.resolve(json(200, { catalog_version: 1, facilities }));
      if (url.endsWith("/demo/mobile-power"))
        return Promise.resolve(json(200, MOBILE_POWER_SAMPLE));
      return Promise.resolve(apiError(404, "NOT_FOUND"));
    });
    vi.stubGlobal("fetch", fn);
    return fn;
  }
  const urls = (fn: ReturnType<typeof stubMobileApi>) =>
    fn.mock.calls.map(([u]) => String(u));

  it("opens from the on-highway brief by hash, calculates without any session call and returns to the map", async () => {
    const fn = stubMobileApi();
    render(<AppShell />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: /On-highway trucks and mobile power/,
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: /Open the Mobile-Site Power Planner/,
      }),
    );
    expect(
      await screen.findByRole("heading", { name: "Mobile-Site Power Planner" }),
    ).toBeInTheDocument();
    expect(window.location.hash).toBe("#mobile-power-planner");

    fireEvent.click(
      screen.getByRole("button", { name: "Calculate site demand" }),
    );
    expect(await screen.findByTestId("site-summary")).toBeInTheDocument();
    expect(urls(fn)).toContain("/api/v1/demo/mobile-power");
    expect(urls(fn).some((u) => /session|configurations/.test(u))).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /← Map/ }));
    await waitFor(() => expect(window.location.hash).toBe(""));
    expect(
      await screen.findByRole("heading", { name: "Explore Power Integration" }),
    ).toBeInTheDocument();
    expect(urls(fn).some((u) => /session|configurations/.test(u))).toBe(false);
  });

  it("opens directly from its address and is not a map facility", async () => {
    window.location.hash = "#mobile-power-planner";
    const fn = stubMobileApi();
    render(<AppShell />);
    expect(
      await screen.findByRole("heading", { name: "Mobile-Site Power Planner" }),
    ).toBeInTheDocument();
    expect(urls(fn).some((u) => /session|configurations/.test(u))).toBe(false);
    window.location.hash = "";
    await screen.findByRole("heading", { name: "Explore Power Integration" });
    expect(facilities.map((f) => f.id)).toEqual(
      expect.not.arrayContaining(["mobile"]),
    );
  });
});

describe("map -> Daventry synthetic workbench", () => {
  function stubWorkbenchApi() {
    const fn = vi.fn((url: string) => {
      if (url.endsWith("/facilities"))
        return Promise.resolve(json(200, { catalog_version: 1, facilities }));
      if (url.endsWith("/demo/capacity-check"))
        return Promise.resolve(json(200, CAPACITY_CASE_1));
      return Promise.resolve(apiError(404, "NOT_FOUND"));
    });
    vi.stubGlobal("fetch", fn);
    return fn;
  }
  const urls = (fn: ReturnType<typeof stubWorkbenchApi>) =>
    fn.mock.calls.map(([u]) => String(u));

  it("labels Daventry as a synthetic workbench next to the factual site description", async () => {
    stubWorkbenchApi();
    render(<AppShell />);
    fireEvent.click(await screen.findByRole("button", { name: /Daventry/ }));
    const card = screen.getByRole("complementary", {
      name: /Daventry site details/,
    });
    expect(within(card).getByText("Synthetic workbench")).toBeInTheDocument();
    expect(within(card).getByText("About the real site")).toBeInTheDocument();
    expect(
      within(card).getByText("Synthetic test description."),
    ).toBeInTheDocument();
    expect(
      within(card).getByText(/the plant's software, operations or data/),
    ).toBeInTheDocument();
    expect(
      within(card).getByRole("button", { name: /Open Synthetic Workbench/ }),
    ).toBeInTheDocument();
    expect(within(card).queryByText(/Lab not modeled/)).toBeNull();
    expect(
      screen.getByRole("button", {
        name: /Daventry — synthetic generator workbench/,
      }),
    ).toBeInTheDocument();
  });

  it("opens the workbench from the card, runs a check and returns to the map without any session call", async () => {
    const fn = stubWorkbenchApi();
    render(<AppShell />);
    fireEvent.click(await screen.findByRole("button", { name: /Daventry/ }));
    fireEvent.click(
      screen.getByRole("button", { name: /Open Synthetic Workbench/ }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "Daventry Generator Configuration Workbench",
      }),
    ).toBeInTheDocument();
    expect(window.location.hash).toBe("#daventry-workbench");

    fireEvent.click(screen.getByRole("button", { name: "Run capacity check" }));
    expect(await screen.findByTestId("demand-summary")).toBeInTheDocument();
    expect(
      screen.getByRole("article", { name: "Synthetic Package C" }),
    ).toBeInTheDocument();

    expect(urls(fn).some((u) => /session|configurations/.test(u))).toBe(false);
    expect(urls(fn)).toContain("/api/v1/demo/capacity-check");

    fireEvent.click(screen.getByRole("button", { name: /← Map/ }));
    await waitFor(() => expect(window.location.hash).toBe(""));
    expect(
      await screen.findByRole("heading", { name: "Explore Power Integration" }),
    ).toBeInTheDocument();
    expect(urls(fn).some((u) => /session|configurations/.test(u))).toBe(false);
  });

  it("opens the workbench directly from its address", async () => {
    window.location.hash = "#daventry-workbench";
    const fn = stubWorkbenchApi();
    render(<AppShell />);
    expect(
      await screen.findByRole("heading", {
        name: "Daventry Generator Configuration Workbench",
      }),
    ).toBeInTheDocument();
    expect(urls(fn).some((u) => /session|configurations/.test(u))).toBe(false);
  });

  it("leaves Fridley as before and gives Seymour its own workbench, never the lab", async () => {
    stubWorkbenchApi();
    render(<AppShell />);
    expect(
      await screen.findAllByRole("button", { name: /Enter Virtual Lab/ }),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /Seymour/ }));
    expect(
      screen.queryByRole("button", { name: /Open Synthetic Workbench/ }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Enter Virtual Lab/ }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: /Open Test-Plan Workbench/ }),
    ).toBeInTheDocument();
  });
});

describe("map -> Seymour synthetic engine test-plan workbench", () => {
  function stubSeymourApi() {
    const fn = vi.fn((url: string) => {
      if (url.endsWith("/facilities"))
        return Promise.resolve(json(200, { catalog_version: 1, facilities }));
      if (url.endsWith("/demo/engine-test-plan"))
        return Promise.resolve(json(200, ENGINE_PLAN_SAMPLE));
      return Promise.resolve(apiError(404, "NOT_FOUND"));
    });
    vi.stubGlobal("fetch", fn);
    return fn;
  }
  const urls = (fn: ReturnType<typeof stubSeymourApi>) =>
    fn.mock.calls.map(([u]) => String(u));

  it("labels Seymour's workbench as synthetic next to the unchanged real-site description", async () => {
    stubSeymourApi();
    render(<AppShell />);
    fireEvent.click(await screen.findByRole("button", { name: /Seymour/ }));
    const card = screen.getByRole("complementary", {
      name: /Seymour site details/,
    });
    expect(within(card).getByText("Synthetic workbench")).toBeInTheDocument();
    expect(within(card).getByText("About the real site")).toBeInTheDocument();
    expect(
      within(card).getByText("Synthetic test description."),
    ).toBeInTheDocument();
    expect(
      within(card).getByText(/the site's software, procedures or data/),
    ).toBeInTheDocument();
    expect(
      within(card).getByText(/Planning coverage only, not verification/),
    ).toBeInTheDocument();
    expect(
      within(card).getByRole("button", { name: /Open Test-Plan Workbench/ }),
    ).toBeInTheDocument();
    expect(
      within(card).getByRole("img", { name: /requirement regions on a speed/ }),
    ).toHaveAttribute("src", "/illustrations/seymour-test-plan.svg");
    expect(
      within(card).queryByRole("button", { name: /Enter Virtual Lab/ }),
    ).toBeNull();
    expect(
      screen.getByRole("button", {
        name: /Seymour — synthetic engine test-plan workbench/,
      }),
    ).toBeInTheDocument();
  });

  it("opens from the card, checks a plan and returns to the map without any session call", async () => {
    const fn = stubSeymourApi();
    render(<AppShell />);
    fireEvent.click(await screen.findByRole("button", { name: /Seymour/ }));
    fireEvent.click(
      screen.getByRole("button", { name: /Open Test-Plan Workbench/ }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "Engine Test-Plan Workbench",
      }),
    ).toBeInTheDocument();
    expect(window.location.hash).toBe("#seymour-test-plan");

    fireEvent.click(
      screen.getByRole("button", { name: "Check plan coverage" }),
    );
    expect(await screen.findByTestId("plan-summary")).toBeInTheDocument();
    expect(screen.getByTestId("verification-banner")).toHaveTextContent(
      "not verified",
    );
    expect(urls(fn)).toContain("/api/v1/demo/engine-test-plan");
    expect(urls(fn).some((u) => /session|configurations/.test(u))).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /← Map/ }));
    await waitFor(() => expect(window.location.hash).toBe(""));
    expect(
      await screen.findByRole("heading", { name: "Explore Power Integration" }),
    ).toBeInTheDocument();
    expect(urls(fn).some((u) => /session|configurations/.test(u))).toBe(false);
  });

  it("opens the workbench directly from its address", async () => {
    window.location.hash = "#seymour-test-plan";
    const fn = stubSeymourApi();
    render(<AppShell />);
    expect(
      await screen.findByRole("heading", {
        name: "Engine Test-Plan Workbench",
      }),
    ).toBeInTheDocument();
    expect(urls(fn).some((u) => /session|configurations/.test(u))).toBe(false);
  });

  it("keeps the other workbenches reachable by their own addresses", async () => {
    stubSeymourApi();
    for (const [hash, heading] of [
      ["#daventry-workbench", "Daventry Generator Configuration Workbench"],
      ["#mobile-power-planner", "Mobile-Site Power Planner"],
    ] as const) {
      window.location.hash = hash;
      const { unmount } = render(<AppShell />);
      expect(
        await screen.findByRole("heading", { level: 1, name: heading }),
      ).toBeInTheDocument();
      unmount();
    }
  });
});

describe("map selection versus explicit lab entry", () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 60));
  const sessionCalls = (fn: ReturnType<typeof stubApi>) =>
    fn.mock.calls.filter(([u]) => /session|configurations/.test(String(u)));

  it("selecting the Fridley marker by pointer only shows its card: no lab, no session", async () => {
    const fn = stubApi();
    render(<AppShell />);
    fireEvent.click(await screen.findByRole("button", { name: /Seymour — / }));
    fireEvent.click(
      screen.getByRole("button", { name: /Fridley — interactive virtual lab/ }),
    );
    await flush();
    expect(window.location.hash).toBe("");
    expect(
      screen.getByRole("heading", { name: "Explore Power Integration" }),
    ).toBeInTheDocument();
    const card = screen.getByRole("complementary", {
      name: /Fridley site details/,
    });
    expect(
      within(card).getByRole("button", { name: /Enter Virtual Lab/ }),
    ).toBeInTheDocument();
    expect(sessionCalls(fn)).toHaveLength(0);
  });

  it("selecting the Fridley marker by keyboard (Enter and Space) does not enter the lab either", async () => {
    const fn = stubApi();
    render(<AppShell />);
    fireEvent.click(await screen.findByRole("button", { name: /Daventry — / }));
    const marker = screen.getByRole("button", {
      name: /Fridley — interactive virtual lab/,
    });
    marker.focus();
    fireEvent.keyDown(marker, { key: "Enter" });
    await flush();
    expect(window.location.hash).toBe("");
    expect(
      screen.getByRole("complementary", { name: /Fridley site details/ }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Seymour — / }));
    fireEvent.keyDown(marker, { key: " " });
    await flush();
    expect(window.location.hash).toBe("");
    expect(sessionCalls(fn)).toHaveLength(0);
  });

  it("tabbing across the other markers does not swap the selected card away, so its button stays reachable", async () => {
    stubApi();
    render(<AppShell />);
    fireEvent.click(await screen.findByRole("button", { name: /Seymour — / }));
    const fridley = screen.getByRole("button", {
      name: /Fridley — interactive virtual lab/,
    });
    fireEvent.keyDown(fridley, { key: "Enter" });
    expect(
      screen.getByRole("complementary", { name: /Fridley site details/ }),
    ).toBeInTheDocument();
    for (const name of [/Seymour — /, /Daventry — /]) {
      const other = screen.getByRole("button", { name });
      other.focus();
      fireEvent.focus(other);
    }
    const card = screen.getByRole("complementary", {
      name: /Fridley site details/,
    });
    expect(
      within(card).getByRole("button", { name: /Enter Virtual Lab/ }),
    ).toBeInTheDocument();
  });

  it("only the card's Enter Virtual Lab action opens the lab and starts the session", async () => {
    const fn = stubApi();
    render(<AppShell />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: /Fridley — interactive virtual lab/,
      }),
    );
    await flush();
    expect(sessionCalls(fn)).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /Enter Virtual Lab/ }));
    await waitFor(() => expect(window.location.hash).toBe("#fridley-lab"));
    expect(
      await screen.findByRole("heading", {
        name: "Fridley Virtual Power Integration Lab",
      }),
    ).toBeInTheDocument();
    expect(sessionCalls(fn).length).toBeGreaterThan(0);
  });

  it("still opens the lab from its address", async () => {
    window.location.hash = "#fridley-lab";
    stubApi();
    render(<AppShell />);
    expect(
      await screen.findByRole("heading", {
        name: "Fridley Virtual Power Integration Lab",
      }),
    ).toBeInTheDocument();
  });

  it("offers a facility picker that shows a card without any session call", async () => {
    const fn = stubApi();
    render(<AppShell />);
    const group = await screen.findByRole("group", {
      name: "Choose a facility",
    });
    const seymour = within(group).getByRole("radio", { name: /Seymour, IN/ });
    expect(within(group).getAllByRole("radio")).toHaveLength(3);
    expect(
      within(group).getByRole("radio", { name: /Fridley, MN/ }),
    ).toBeChecked();
    fireEvent.click(seymour);
    expect(seymour).toBeChecked();
    expect(
      screen.getByRole("complementary", { name: /Seymour site details/ }),
    ).toBeInTheDocument();
    fireEvent.click(within(group).getByRole("radio", { name: /Fridley, MN/ }));
    await flush();
    expect(window.location.hash).toBe("");
    expect(sessionCalls(fn)).toHaveLength(0);
  });
});

describe("landing page: the five experiences", () => {
  it("lists all five with links that reuse the existing hash routes", async () => {
    stubApi();
    render(<AppShell />);
    const section = await screen.findByRole("region", {
      name: "Five hands-on experiences",
    });
    const links = within(section).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "#fridley-lab",
      "#seymour-test-plan",
      "#daventry-workbench",
      "#mining-duty-cycle",
      "#mobile-power-planner",
    ]);
    expect(within(section).getAllByRole("listitem")).toHaveLength(5);
    expect(section).toHaveTextContent(
      /Interactive lab · saves a demo workspace/,
    );
    expect(section).toHaveTextContent(
      /synthetic and independent of Cummins Inc\./,
    );
  });

  it("opens Mining and Mobile Power directly from the landing links", async () => {
    stubApi();
    render(<AppShell />);
    const section = await screen.findByRole("region", {
      name: "Five hands-on experiences",
    });
    fireEvent.click(
      within(section).getByRole("link", {
        name: /Open the duty-cycle analyzer/,
      }),
    );
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Mining Duty-Cycle Energy Analyzer",
      }),
    ).toBeInTheDocument();
  });
});

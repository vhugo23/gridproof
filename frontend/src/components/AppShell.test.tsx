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
  apiError,
  current,
  facilities,
  json,
} from "@/test/fixtures";
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
    expect(screen.getByText(/Lab not modeled/)).toBeInTheDocument();
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

  it("leaves Fridley and Seymour as before", async () => {
    stubWorkbenchApi();
    render(<AppShell />);
    expect(
      await screen.findAllByRole("button", { name: /Enter Virtual Lab/ }),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /Seymour/ }));
    expect(screen.getByText(/Lab not modeled/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Open Synthetic Workbench/ }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Enter Virtual Lab/ }),
    ).toBeNull();
  });
});

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SystemConfigV1 } from "@/lib/types";
import {
  apiError,
  config,
  current,
  evidence,
  facilities,
  json,
} from "@/test/fixtures";
import AppShell from "../AppShell";

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

/** In-memory stand-in for the backend: versions are saved, and checks read them back. */
function stubApi() {
  const versions: SystemConfigV1[] = [config(5)];
  const control = { failChecks: false };
  const latest = () => {
    const n = versions.length;
    const base = current(n);
    return { ...base, snapshot: versions[n - 1] };
  };
  const fn = vi.fn((url: string, init?: RequestInit) => {
    if (url.endsWith("/facilities"))
      return Promise.resolve(json(200, { catalog_version: 1, facilities }));
    if (url.endsWith("/configurations/current"))
      return Promise.resolve(json(200, latest()));
    if (init?.method === "POST" && url.endsWith("/demo/startup-check")) {
      if (control.failChecks) {
        return Promise.resolve(apiError(503, "DATABASE_UNAVAILABLE"));
      }
      const { version_number } = JSON.parse(String(init.body));
      const snap = versions[version_number - 1];
      const delay = snap.equipment.g1.startup_delay_s;
      const load = snap.equipment.load.critical_kw;
      // Hand-calculated: (400 - 250) kW x 15 s / 3600 = 0.625 kWh; other cases serve fully.
      const unserved = load === 400 && delay === 15 ? 0.625 : 0;
      return Promise.resolve(
        json(
          200,
          evidence({
            version: version_number,
            delay,
            load,
            unservedKwh: unserved,
          }),
        ),
      );
    }
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      versions.push(body.snapshot);
      const saved = latest();
      return Promise.resolve(
        json(201, {
          configuration_id: saved.configuration_id,
          version_id: saved.version_id,
          version_number: versions.length,
          schema_version: "config-v1",
          saved_at: saved.saved_at,
        }),
      );
    }
    return Promise.resolve(apiError(404, "NOT_FOUND"));
  });
  vi.stubGlobal("fetch", fn);
  return { fn, versions, control };
}

const saves = (fn: ReturnType<typeof stubApi>["fn"]) =>
  fn.mock.calls.filter(
    ([u, i]) =>
      i?.method === "POST" && !String(u).endsWith("/demo/startup-check"),
  );

async function launch(card: RegExp, action: RegExp) {
  fireEvent.click(await screen.findByRole("button", { name: card }));
  fireEvent.click(screen.getByRole("button", { name: action }));
  await screen.findByRole("button", { name: /Run Utility-Outage Test/ });
}

const panel = (name: RegExp) => screen.findByRole("region", { name });
const run = async () => {
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: /Run Utility-Outage Test/ }),
    ).toBeEnabled(),
  );
  fireEvent.click(
    screen.getByRole("button", { name: /Run Utility-Outage Test/ }),
  );
};
const save = async () => {
  fireEvent.click(screen.getByRole("tab", { name: "Inspector" }));
  fireEvent.click(screen.getByRole("button", { name: /Save as new version/ }));
  await screen.findByText("Saved and confirmed from the server.");
};

describe("ordinary workflow", () => {
  it("shows no challenge when the lab is entered from the map", async () => {
    stubApi();
    render(<AppShell />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Enter Virtual Lab/ }),
    );
    await screen.findByRole("button", { name: /Run Utility-Outage Test/ });
    expect(screen.queryByRole("region", { name: /challenge/i })).toBeNull();
  });

  it("clears the challenge when returning to the map and entering normally", async () => {
    stubApi();
    render(<AppShell />);
    await launch(/Power generation/, /G1 startup challenge/);
    await panel(/G1 startup challenge/);
    fireEvent.click(screen.getByRole("button", { name: /← Map/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: /Enter Virtual Lab/ }),
    );
    await screen.findByRole("button", { name: /Run Utility-Outage Test/ });
    expect(screen.queryByRole("region", { name: /challenge/i })).toBeNull();
  });
});

describe("G1 startup challenge", () => {
  it("goes from preset to saved failure to repair using real saved state and live evidence", async () => {
    const { fn, versions } = stubApi();
    render(<AppShell />);
    await launch(/Power generation/, /G1 startup challenge/);
    const region = await panel(/G1 startup challenge/);
    expect(within(region).getByRole("status")).toHaveTextContent(/step 1 of 4/);

    // The preset edits the draft only.
    fireEvent.click(
      within(region).getByRole("button", {
        name: /Set G1 startup delay to 15 s in my draft/,
      }),
    );
    expect(screen.getByLabelText("Startup delay")).toHaveValue("15");
    expect(saves(fn)).toHaveLength(0);
    expect(versions).toHaveLength(1);
    expect(within(region).getByRole("status")).toHaveTextContent(/step 2 of 4/);

    // Running is blocked until the draft is saved; nothing saves automatically.
    expect(
      screen.getByRole("button", { name: /Run Utility-Outage Test/ }),
    ).toBeDisabled();

    await save();
    expect(saves(fn)).toHaveLength(1);
    expect(versions[1].equipment.g1.startup_delay_s).toBe(15);
    expect(within(region).getByRole("status")).toHaveTextContent(/step 3 of 4/);

    await run();
    await waitFor(() =>
      expect(within(region).getByRole("status")).toHaveTextContent(
        /all steps complete/,
      ),
    );
    expect(within(region).getByText(/15000 ms/)).toBeInTheDocument();
    expect(within(region).getByText(/Optional repair/)).toBeInTheDocument();

    // Repair at exactly 10 s (inclusive boundary), saved, then a fresh run.
    fireEvent.click(
      within(region).getByRole("button", {
        name: /Set G1 startup delay to 10 s in my draft/,
      }),
    );
    await save();
    expect(versions[2].equipment.g1.startup_delay_s).toBe(10);
    await run();
    await waitFor(() =>
      expect(within(region).getByRole("status")).toHaveTextContent(
        /complete, repaired/,
      ),
    );
  });

  it("does not require a save when the saved version already has a long delay", async () => {
    const { fn, versions } = stubApi();
    versions.push(config(12)); // visitor is already on v2 with a 12 s G1
    render(<AppShell />);
    await launch(/Power generation/, /G1 startup challenge/);
    const region = await panel(/G1 startup challenge/);
    expect(within(region).getByRole("status")).toHaveTextContent(/step 3 of 4/);
    expect(
      within(region).queryByRole("button", { name: /Set G1 startup delay/ }),
    ).toBeNull();
    await run();
    await waitFor(() =>
      expect(within(region).getByRole("status")).toHaveTextContent(
        /all steps complete/,
      ),
    );
    expect(saves(fn)).toHaveLength(0);
  });

  it("preserves unsaved edits made before launching and never saves them", async () => {
    const { fn } = stubApi();
    render(<AppShell />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Enter Virtual Lab/ }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /Generator G1/ }),
    );
    fireEvent.change(screen.getByLabelText("Startup delay"), {
      target: { value: "7" },
    });
    fireEvent.click(screen.getByRole("button", { name: /← Map/ }));
    await launch(/Power generation/, /G1 startup challenge/);
    await panel(/G1 startup challenge/);
    expect(screen.getByLabelText("Startup delay")).toHaveValue("7");
    expect(screen.getByText("Unsaved changes.")).toBeInTheDocument();
    expect(saves(fn)).toHaveLength(0);
  });

  it("does not enable a disabled G1 when the preset is used", async () => {
    stubApi();
    render(<AppShell />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Enter Virtual Lab/ }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /Generator G1/ }),
    );
    fireEvent.click(screen.getByLabelText("Enabled"));
    fireEvent.click(screen.getByRole("button", { name: /← Map/ }));
    await launch(/Power generation/, /G1 startup challenge/);
    const region = await panel(/G1 startup challenge/);
    expect(within(region).getByText(/G1 is disabled/)).toBeInTheDocument();
    fireEvent.click(
      within(region).getByRole("button", {
        name: /Set G1 startup delay to 15 s/,
      }),
    );
    expect(screen.getByLabelText("Enabled")).not.toBeChecked();
    expect(screen.getByLabelText("Startup delay")).toHaveValue("15");
    expect(within(region).getByRole("status")).toHaveTextContent(/step 1 of 4/);
  });

  it("can be collapsed and dismissed", async () => {
    stubApi();
    render(<AppShell />);
    await launch(/Power generation/, /G1 startup challenge/);
    const region = await panel(/G1 startup challenge/);
    const toggle = within(region).getByRole("button", {
      name: /G1 startup challenge · step 1 of 4/,
    });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(within(region).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("region", { name: /challenge/i })).toBeNull();
  });
});

describe("battery continuity challenge", () => {
  it("hides the explanation until a prediction and a new live run", async () => {
    const { fn, versions } = stubApi();
    versions.push(config(15)); // v2 already has G1 at 15 s
    render(<AppShell />);
    await launch(/Battery storage/, /battery continuity challenge/);
    const region = await panel(/Battery continuity challenge/);

    // A test run before predicting must not satisfy the challenge later.
    await run();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Run Utility-Outage Test/ }),
      ).toBeEnabled(),
    );

    // Preset touches only the load in the draft.
    fireEvent.click(
      within(region).getByRole("button", {
        name: /Set critical load to 400 kW in my draft/,
      }),
    );
    expect(saves(fn)).toHaveLength(0);
    await save();
    expect(versions[2].equipment.load.critical_kw).toBe(400);
    expect(versions[2].equipment.g1.startup_delay_s).toBe(15);
    expect(versions[2].equipment.g1.enabled).toBe(true);

    expect(
      within(region).getByRole("group", { name: /Prediction for saved v3/ }),
    ).toBeInTheDocument();
    expect(within(region).queryByText(/Evidence for v/)).toBeNull();

    // Even a run of v3 before predicting does not reveal.
    await run();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Run Utility-Outage Test/ }),
      ).toBeEnabled(),
    );
    expect(within(region).queryByText(/Evidence for v/)).toBeNull();

    fireEvent.click(within(region).getByLabelText(/Some demand goes unserved/));
    fireEvent.click(
      within(region).getByRole("button", { name: "Lock in prediction" }),
    );
    expect(within(region).queryByText(/Evidence for v/)).toBeNull();
    expect(within(region).getByText(/Prediction locked for v3/)).toBeVisible();

    await run();
    const result = await within(region).findByRole("region", {
      name: "Result and explanation",
    });
    expect(
      within(result).getByText(/continuity requirement failed/),
    ).toBeInTheDocument();
    expect(within(result).getByText(/Your prediction matched/)).toBeVisible();
    expect(
      within(result).getByText(/Unserved energy reported: 0\.625 kWh/),
    ).toBeVisible();
    expect(
      within(result).getByText(/battery supplied 250 kW and 150 kW/),
    ).toBeVisible();
  });

  it("is not advanced by recorded demo playback", async () => {
    const { versions } = stubApi();
    versions.push(config(15), config(15));
    versions[2].equipment.load.critical_kw = 400;
    render(<AppShell />);
    await launch(/Battery storage/, /battery continuity challenge/);
    const region = await panel(/Battery continuity challenge/);
    fireEvent.click(within(region).getByLabelText(/Some demand goes unserved/));
    fireEvent.click(
      within(region).getByRole("button", { name: "Lock in prediction" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Show recorded demo/ }));
    expect(within(region).queryByText(/Evidence for v/)).toBeNull();
    expect(
      within(region).getByText(/Recorded demo playback does not count/),
    ).toBeVisible();
  });
});

describe("drafts and results are never overwritten or mis-credited", () => {
  it("keeps unrelated unsaved edits through presets and dismissal, and saves nothing", async () => {
    const { fn, versions } = stubApi();
    render(<AppShell />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Enter Virtual Lab/ }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /Generator G2/ }),
    );
    fireEvent.change(screen.getByLabelText("Startup delay"), {
      target: { value: "9" },
    });
    fireEvent.click(screen.getByRole("button", { name: /← Map/ }));
    await launch(/Battery storage/, /battery continuity challenge/);
    const region = await panel(/Battery continuity challenge/);
    fireEvent.click(
      within(region).getByRole("button", {
        name: /Set critical load to 400 kW in my draft/,
      }),
    );
    fireEvent.click(within(region).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("region", { name: /challenge/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Generator G2/ }));
    expect(screen.getByLabelText("Startup delay")).toHaveValue("9");
    fireEvent.click(screen.getByRole("button", { name: /Critical Load/ }));
    expect(screen.getByLabelText("Critical load")).toHaveValue("400");
    expect(screen.getByText("Unsaved changes.")).toBeInTheDocument();
    expect(saves(fn)).toHaveLength(0);
    expect(versions).toHaveLength(1);
  });

  it("does not reveal or advance when the run after the prediction fails", async () => {
    const { versions, control } = stubApi();
    versions.push(config(15));
    versions[1].equipment.load.critical_kw = 400;
    render(<AppShell />);
    await launch(/Battery storage/, /battery continuity challenge/);
    const region = await panel(/Battery continuity challenge/);
    fireEvent.click(within(region).getByLabelText(/Some demand goes unserved/));
    fireEvent.click(
      within(region).getByRole("button", { name: "Lock in prediction" }),
    );
    control.failChecks = true;
    await run();
    await waitFor(() =>
      expect(
        screen.getByText(/The GridProof API is unavailable/),
      ).toBeVisible(),
    );
    expect(within(region).queryByText(/Evidence for v/)).toBeNull();
    expect(within(region).getByRole("status")).toHaveTextContent(/step 4 of 5/);

    control.failChecks = false;
    await run();
    await within(region).findByRole("region", {
      name: "Result and explanation",
    });
  });

  it("does not credit the G1 failure steps when the run fails", async () => {
    const { versions, control } = stubApi();
    versions.push(config(15));
    render(<AppShell />);
    await launch(/Power generation/, /G1 startup challenge/);
    const region = await panel(/G1 startup challenge/);
    control.failChecks = true;
    await run();
    await waitFor(() =>
      expect(
        screen.getByText(/The GridProof API is unavailable/),
      ).toBeVisible(),
    );
    expect(within(region).getByRole("status")).toHaveTextContent(/step 3 of 4/);
  });
});

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiError, config, current, json } from "@/test/fixtures";
import { useWorkspaceConfig } from "./useWorkspaceConfig";

afterEach(() => vi.unstubAllGlobals());

type Route = (url: string, init?: RequestInit) => Response;
function stubRoutes(route: Route) {
  const fn = vi.fn((url: string, init?: RequestInit) =>
    Promise.resolve(route(url, init)),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

function setG1Delay(seconds: number) {
  return (c: ReturnType<typeof config>) => ({
    ...c,
    equipment: {
      ...c.equipment,
      g1: { ...c.equipment.g1, startup_delay_s: seconds },
    },
  });
}

describe("useWorkspaceConfig", () => {
  it("does not touch the network until enabled", () => {
    const fetchMock = stubRoutes(() => json(200, current()));
    renderHook(() => useWorkspaceConfig(false));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("saves 5 -> 15 with expected_version and confirms v2 from /current", async () => {
    let latest = current(1, 5);
    const fetchMock = stubRoutes((url, init) => {
      if (url.endsWith("/configurations/current")) return json(200, latest);
      if (url.includes("/versions") && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        latest = current(2, body.snapshot.equipment.g1.startup_delay_s);
        return json(201, {
          configuration_id: latest.configuration_id,
          version_id: latest.version_id,
          version_number: 2,
          schema_version: "config-v1",
          saved_at: latest.saved_at,
        });
      }
      return apiError(404, "NOT_FOUND");
    });
    const { result } = renderHook(() => useWorkspaceConfig(true));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect(result.current.dirty).toBe(false);

    act(() => result.current.updateDraft(setG1Delay(15)));
    expect(result.current.dirty).toBe(true);

    await act(() => result.current.save());
    const post = fetchMock.mock.calls.find(([, i]) => i?.method === "POST")!;
    const sent = JSON.parse(String(post[1]!.body));
    expect(sent.expected_version).toBe(1);
    expect(sent.snapshot.equipment.g1.startup_delay_s).toBe(15);
    expect(result.current.server?.latest_version).toBe(2);
    expect(result.current.saveStatus).toBe("saved");
    expect(result.current.dirty).toBe(false);
    expect(result.current.draft?.equipment.g1.startup_delay_s).toBe(15);
  });

  it("keeps the draft and exposes field errors on 422", async () => {
    stubRoutes((_url, init) =>
      init?.method === "POST"
        ? apiError(422, "VALIDATION_ERROR", [
            {
              field: "snapshot.equipment.g1.startup_delay_s",
              reason: "Must be between 0 and 120",
            },
          ])
        : json(200, current()),
    );
    const { result } = renderHook(() => useWorkspaceConfig(true));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    act(() => result.current.updateDraft(setG1Delay(121)));
    await act(() => result.current.save());
    expect(result.current.issue).toMatchObject({
      kind: "validation",
      fieldErrors: {
        "equipment.g1.startup_delay_s": "Must be between 0 and 120",
      },
    });
    expect(result.current.draft?.equipment.g1.startup_delay_s).toBe(121);
    expect(result.current.server?.latest_version).toBe(1);
  });

  it("keeps the draft on a 409 and only replaces it on explicit reload", async () => {
    let stale = true;
    stubRoutes((_url, init) => {
      if (init?.method === "POST")
        return apiError(409, "VERSION_CONFLICT", [
          { field: "current_version", reason: "2" },
        ]);
      return json(200, stale ? current(1, 5) : current(2, 30));
    });
    const { result } = renderHook(() => useWorkspaceConfig(true));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    act(() => result.current.updateDraft(setG1Delay(15)));
    await act(() => result.current.save());
    expect(result.current.issue).toMatchObject({
      kind: "conflict",
      currentVersion: 2,
    });
    expect(result.current.draft?.equipment.g1.startup_delay_s).toBe(15);

    stale = false;
    await act(() => result.current.reload());
    expect(result.current.draft?.equipment.g1.startup_delay_s).toBe(30);
    expect(result.current.server?.latest_version).toBe(2);
    expect(result.current.issue).toBeNull();
  });

  it("on session expiry keeps the draft until the user starts a new session", async () => {
    stubRoutes((url, init) => {
      if (url.endsWith("/session"))
        return json(200, { workspace_id: "w2", expires_at: "x", is_new: true });
      if (init?.method === "POST") return apiError(401, "WORKSPACE_EXPIRED");
      return json(200, current(1, 5));
    });
    const { result } = renderHook(() => useWorkspaceConfig(true));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    act(() => result.current.updateDraft(setG1Delay(15)));
    await act(() => result.current.save());
    expect(result.current.issue?.kind).toBe("session");
    expect(result.current.draft?.equipment.g1.startup_delay_s).toBe(15);

    await act(() => result.current.recoverSession());
    expect(result.current.issue).toBeNull();
    expect(result.current.draft?.equipment.g1.startup_delay_s).toBe(15);
    // Still unsaved against the new workspace's configuration.
    expect(result.current.dirty).toBe(true);
  });

  it("surfaces an outage without losing the draft", async () => {
    stubRoutes((_url, init) =>
      init?.method === "POST"
        ? apiError(503, "DATABASE_UNAVAILABLE")
        : json(200, current()),
    );
    const { result } = renderHook(() => useWorkspaceConfig(true));
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    act(() => result.current.updateDraft(setG1Delay(15)));
    await act(() => result.current.save());
    expect(result.current.issue?.kind).toBe("unavailable");
    expect(result.current.draft?.equipment.g1.startup_delay_s).toBe(15);
  });

  it("reports a load failure with a retry path", async () => {
    stubRoutes(() => apiError(503, "CATALOG_UNAVAILABLE"));
    const { result } = renderHook(() => useWorkspaceConfig(true));
    await waitFor(() => expect(result.current.phase).toBe("error"));
    expect(result.current.loadError).toBeTruthy();
  });
});

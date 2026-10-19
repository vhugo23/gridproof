import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiError, evidence, json } from "@/test/fixtures";
import { useStartupComparison } from "./useStartupComparison";

afterEach(() => vi.unstubAllGlobals());

const CONFIG_ID = "11111111-1111-4111-8111-111111111111";

/** Each startup-check call waits until the test settles it. */
function deferredChecks() {
  const pending: Array<{
    version: number;
    ok: (response: Response) => void;
  }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init?: RequestInit) => {
      const { version_number } = JSON.parse(String(init?.body));
      return new Promise<Response>((resolve) =>
        pending.push({ version: version_number, ok: resolve }),
      );
    }),
  );
  return {
    pending,
    resolveAll(status: "ok" | "fail" = "ok") {
      for (const call of pending.splice(0)) {
        call.ok(
          status === "ok"
            ? json(200, evidence({ version: call.version, delay: 5 }))
            : apiError(503, "DATABASE_UNAVAILABLE"),
        );
      }
    },
  };
}

describe("useStartupComparison result sequence", () => {
  it("advances once per completed live run", async () => {
    const checks = deferredChecks();
    const { result } = renderHook(() => useStartupComparison());
    act(() => void result.current.run(CONFIG_ID, 1));
    await waitFor(() => expect(checks.pending).toHaveLength(1));
    await act(async () => checks.resolveAll());
    await waitFor(() => expect(result.current.result?.seq).toBe(1));

    act(() => void result.current.run(CONFIG_ID, 1));
    await waitFor(() => expect(checks.pending).toHaveLength(1));
    await act(async () => checks.resolveAll());
    await waitFor(() => expect(result.current.result?.seq).toBe(2));
  });

  it("does not advance when a run fails, and keeps the previous result as it was", async () => {
    const checks = deferredChecks();
    const { result } = renderHook(() => useStartupComparison());
    act(() => void result.current.run(CONFIG_ID, 1));
    await waitFor(() => expect(checks.pending).toHaveLength(1));
    await act(async () => checks.resolveAll());
    await waitFor(() => expect(result.current.result?.seq).toBe(1));

    act(() => void result.current.run(CONFIG_ID, 1));
    await waitFor(() => expect(checks.pending).toHaveLength(1));
    await act(async () => checks.resolveAll("fail"));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.result?.seq).toBe(1);

    act(() => void result.current.run(CONFIG_ID, 1));
    await waitFor(() => expect(checks.pending).toHaveLength(1));
    await act(async () => checks.resolveAll());
    await waitFor(() => expect(result.current.result?.seq).toBe(2));
  });

  it("ignores a run that was superseded by a newer one", async () => {
    const checks = deferredChecks();
    const { result } = renderHook(() => useStartupComparison());
    act(() => void result.current.run(CONFIG_ID, 1));
    await waitFor(() => expect(checks.pending).toHaveLength(1));
    const first = checks.pending.splice(0);
    act(() => void result.current.run(CONFIG_ID, 1));
    await waitFor(() => expect(checks.pending).toHaveLength(1));

    await act(async () => checks.resolveAll());
    await waitFor(() => expect(result.current.result?.seq).toBe(1));
    // The older run settles late and must change nothing.
    await act(async () =>
      first[0].ok(json(200, evidence({ version: 1, delay: 5 }))),
    );
    expect(result.current.result?.seq).toBe(1);
  });

  it("ignores a run that finishes after the results were cleared", async () => {
    const checks = deferredChecks();
    const { result } = renderHook(() => useStartupComparison());
    act(() => void result.current.run(CONFIG_ID, 1));
    await waitFor(() => expect(checks.pending).toHaveLength(1));
    act(() => result.current.clear());
    await act(async () => checks.resolveAll());
    expect(result.current.result).toBeNull();
    expect(result.current.status).toBe("idle");

    act(() => void result.current.run(CONFIG_ID, 1));
    await waitFor(() => expect(checks.pending).toHaveLength(1));
    await act(async () => checks.resolveAll());
    await waitFor(() => expect(result.current.result?.seq).toBe(1));
  });

  it("does not advance for recorded-demo results", async () => {
    const checks = deferredChecks();
    const { result } = renderHook(() => useStartupComparison());
    act(() => result.current.showRecorded());
    expect(result.current.result).toMatchObject({ mode: "recorded", seq: 0 });

    act(() => void result.current.run(CONFIG_ID, 1));
    await waitFor(() => expect(checks.pending).toHaveLength(1));
    await act(async () => checks.resolveAll());
    await waitFor(() => expect(result.current.result?.seq).toBe(1));

    act(() => result.current.showRecorded());
    expect(result.current.result).toMatchObject({ mode: "recorded", seq: 1 });
    act(() => void result.current.run(CONFIG_ID, 1));
    await waitFor(() => expect(checks.pending).toHaveLength(1));
    await act(async () => checks.resolveAll());
    await waitFor(() => expect(result.current.result?.seq).toBe(2));
  });
});

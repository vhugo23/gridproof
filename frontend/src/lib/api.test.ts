import { afterEach, describe, expect, it, vi } from "vitest";
import { apiError, current, json } from "@/test/fixtures";
import {
  ApiError,
  getFacilities,
  loadCurrentConfiguration,
  saveVersion,
} from "./api";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(...responses: Array<Response | Error>) {
  const fn = vi.fn();
  for (const r of responses) {
    if (r instanceof Error) fn.mockRejectedValueOnce(r);
    else fn.mockResolvedValueOnce(r);
  }
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("api client", () => {
  it("maps the error envelope, including the 409 current version", async () => {
    stubFetch(
      apiError(409, "VERSION_CONFLICT", [
        { field: "current_version", reason: "3" },
      ]),
    );
    const error = (await saveVersion("id", {
      expected_version: 1,
      name: "n",
      snapshot: current().snapshot,
    }).catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe("conflict");
    expect(error.code).toBe("VERSION_CONFLICT");
    expect(error.currentVersion).toBe(3);
  });

  it("classifies 422 as validation and keeps field details", async () => {
    stubFetch(
      apiError(422, "VALIDATION_ERROR", [
        { field: "snapshot.equipment.g1.startup_delay_s", reason: "Too big" },
      ]),
    );
    const error = (await getFacilities().catch((e: unknown) => e)) as ApiError;
    expect(error.kind).toBe("validation");
    expect(error.details[0].reason).toBe("Too big");
  });

  it("reports network failure and malformed success bodies as unavailable", async () => {
    stubFetch(
      new TypeError("offline"),
      new Response("not json", { status: 200 }),
    );
    await expect(getFacilities()).rejects.toMatchObject({
      kind: "unavailable",
    });
    await expect(getFacilities()).rejects.toMatchObject({
      kind: "unavailable",
    });
  });

  it("bootstraps a session once on 401 then retries the read", async () => {
    const fetchMock = stubFetch(
      apiError(401, "SESSION_REQUIRED"),
      json(200, { workspace_id: "w", expires_at: "x", is_new: true }),
      json(200, current()),
    );
    const result = await loadCurrentConfiguration();
    expect(result.latest_version).toBe(1);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      "/api/v1/configurations/current",
      "/api/v1/session",
      "/api/v1/configurations/current",
    ]);
  });

  it("does not loop if the retry after bootstrap is still unauthorized", async () => {
    const fetchMock = stubFetch(
      apiError(401, "SESSION_REQUIRED"),
      json(200, { workspace_id: "w", expires_at: "x", is_new: true }),
      apiError(401, "SESSION_REQUIRED"),
    );
    await expect(loadCurrentConfiguration()).rejects.toMatchObject({
      kind: "unauthorized",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

import type {
  CapacityCheckEvidence,
  CapacityCheckRequest,
  CurrentConfiguration,
  DutyCycleEvidence,
  DutyCycleRequest,
  ErrorDetail,
  FacilitiesResponse,
  SavedVersion,
  SessionResponse,
  StartupCheckEvidence,
  SystemConfigV1,
} from "./types";

export type ApiErrorKind =
  | "unauthorized" // 401: session missing or expired
  | "conflict" // 409: stale expected_version
  | "validation" // 422 / 400
  | "forbidden" // 403
  | "unavailable" // 503, 5xx, network failure, bad response
  | "other";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number;
  readonly code: string;
  readonly details: ErrorDetail[];
  readonly requestId: string | null;

  constructor(init: {
    kind: ApiErrorKind;
    status: number;
    code: string;
    message: string;
    details?: ErrorDetail[];
    requestId?: string | null;
  }) {
    super(init.message);
    this.name = "ApiError";
    this.kind = init.kind;
    this.status = init.status;
    this.code = init.code;
    this.details = init.details ?? [];
    this.requestId = init.requestId ?? null;
  }

  /** For 409 VERSION_CONFLICT: the version number the server currently holds. */
  get currentVersion(): number | null {
    const detail = this.details.find((d) => d.field === "current_version");
    const value = detail ? Number(detail.reason) : NaN;
    return Number.isInteger(value) ? value : null;
  }
}

const BASE = "/api/v1";

function kindFor(status: number): ApiErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 409) return "conflict";
  if (status === 403) return "forbidden";
  if (status === 400 || status === 422) return "validation";
  if (status >= 500) return "unavailable";
  return "other";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseDetails(value: unknown): ErrorDetail[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) =>
    isRecord(item) &&
    typeof item.field === "string" &&
    typeof item.reason === "string"
      ? [{ field: item.field, reason: item.reason }]
      : [],
  );
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      credentials: "same-origin",
      cache: "no-store",
      ...init,
    });
  } catch {
    throw new ApiError({
      kind: "unavailable",
      status: 0,
      code: "NETWORK_ERROR",
      message: "Could not reach the GridProof API.",
    });
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const envelope = isRecord(body) && isRecord(body.error) ? body.error : {};
    throw new ApiError({
      kind: kindFor(response.status),
      status: response.status,
      code: typeof envelope.code === "string" ? envelope.code : "UNKNOWN",
      message:
        typeof envelope.message === "string"
          ? envelope.message
          : `Request failed (${response.status}).`,
      details: parseDetails(envelope.details),
      requestId:
        typeof envelope.request_id === "string" ? envelope.request_id : null,
    });
  }

  if (!isRecord(body)) {
    throw new ApiError({
      kind: "unavailable",
      status: response.status,
      code: "BAD_RESPONSE",
      message: "The GridProof API returned an unexpected response.",
    });
  }
  return body as T;
}

export function getFacilities(): Promise<FacilitiesResponse> {
  return request<FacilitiesResponse>("/facilities");
}

export function getSession(): Promise<SessionResponse> {
  return request<SessionResponse>("/session");
}

export function getCurrentConfiguration(): Promise<CurrentConfiguration> {
  return request<CurrentConfiguration>("/configurations/current");
}

export function saveVersion(
  configurationId: string,
  payload: {
    expected_version: number;
    name: string;
    snapshot: SystemConfigV1;
  },
): Promise<SavedVersion> {
  return request<SavedVersion>(
    `/configurations/${encodeURIComponent(configurationId)}/versions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
}

/** Stateless: evaluates a saved version; the server reads the equipment values. */
export function runStartupCheck(
  configurationId: string,
  versionNumber: number,
): Promise<StartupCheckEvidence> {
  return request<StartupCheckEvidence>("/demo/startup-check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      configuration_id: configurationId,
      version_number: versionNumber,
    }),
  });
}

/**
 * Load the workspace's current configuration. On a 401 the session is
 * (re)initialised explicitly via GET /session and the read is retried once.
 * Callers hold any unsaved draft; nothing here touches it.
 */
export async function loadCurrentConfiguration(): Promise<CurrentConfiguration> {
  try {
    return await getCurrentConfiguration();
  } catch (error) {
    if (error instanceof ApiError && error.kind === "unauthorized") {
      await getSession();
      return getCurrentConfiguration();
    }
    throw error;
  }
}

/**
 * Stateless and session-free (API-17): the server validates the numbers and
 * returns the deterministic capacity check for four synthetic packages.
 */
export function runCapacityCheck(
  payload: CapacityCheckRequest,
): Promise<CapacityCheckEvidence> {
  return request<CapacityCheckEvidence>("/demo/capacity-check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/**
 * Stateless and session-free (API-18): the server validates the user's
 * duty-cycle segments and returns the deterministic energy analysis.
 */
export function runDutyCycle(
  payload: DutyCycleRequest,
): Promise<DutyCycleEvidence> {
  return request<DutyCycleEvidence>("/demo/duty-cycle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

"use client";

import { useCallback, useRef, useState } from "react";
import { ApiError, runCapacityCheck } from "./api";
import type { CapacityCheckEvidence, CapacityCheckRequest } from "./types";

export type CapacityStatus = "idle" | "running" | "done" | "error";

export type CapacityError = {
  kind: "validation" | "forbidden" | "unavailable" | "server" | "other";
  message: string;
  /** Server field errors keyed by request field (for example "power_factor"). */
  fieldErrors: Record<string, string>;
};

function toError(error: unknown): CapacityError {
  if (!(error instanceof ApiError)) {
    return {
      kind: "other",
      message: "The capacity check could not be run.",
      fieldErrors: {},
    };
  }
  if (error.kind === "validation") {
    const fieldErrors: Record<string, string> = {};
    for (const detail of error.details)
      fieldErrors[detail.field] = detail.reason;
    return {
      kind: "validation",
      message: "The server rejected one or more inputs.",
      fieldErrors,
    };
  }
  if (error.kind === "forbidden") {
    return {
      kind: "forbidden",
      message:
        "The backend rejected this site's origin for the request (FRONTEND_ORIGINS does not include it).",
      fieldErrors: {},
    };
  }
  // The API answered with its own 500: it is reachable, so say that rather than
  // "unavailable" (which is for network failures, 503 and gateway errors).
  if (error.code === "INTERNAL_ERROR") {
    return {
      kind: "server",
      message:
        "The server hit an unexpected error. Nothing was changed; try again.",
      fieldErrors: {},
    };
  }
  if (error.kind === "unavailable") {
    return {
      kind: "unavailable",
      message: "The GridProof API is unavailable. Nothing was changed.",
      fieldErrors: {},
    };
  }
  return { kind: "other", message: error.message, fieldErrors: {} };
}

/**
 * Runs the stateless Daventry capacity check. It never touches the session, the
 * Fridley configuration or any saved data. A response that arrives after a newer
 * run was started is ignored.
 */
export function useCapacityCheck() {
  const [status, setStatus] = useState<CapacityStatus>("idle");
  const [result, setResult] = useState<CapacityCheckEvidence | null>(null);
  const [error, setError] = useState<CapacityError | null>(null);
  const runId = useRef(0);

  const run = useCallback(async (request: CapacityCheckRequest) => {
    const id = ++runId.current;
    setStatus("running");
    setError(null);
    try {
      const evidence = await runCapacityCheck(request);
      if (id !== runId.current) return;
      setResult(evidence);
      setStatus("done");
    } catch (e) {
      if (id !== runId.current) return;
      setError(toError(e));
      setStatus("error");
    }
  }, []);

  const clear = useCallback(() => {
    runId.current++;
    setResult(null);
    setError(null);
    setStatus("idle");
  }, []);

  return { status, result, error, run, clear };
}

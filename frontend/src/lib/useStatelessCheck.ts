"use client";

import { useCallback, useRef, useState } from "react";
import { ApiError } from "./api";

export type CheckStatus = "idle" | "running" | "done" | "error";

export type CheckError = {
  kind: "validation" | "forbidden" | "unavailable" | "other";
  message: string;
  /** Server field errors keyed by the API field path (for example "segments.0.power_kw"). */
  fieldErrors: Record<string, string>;
};

function toError(error: unknown): CheckError {
  if (!(error instanceof ApiError)) {
    return {
      kind: "other",
      message: "The check could not be run.",
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
 * Runs one stateless, session-free server calculation. It never touches the
 * session, the Fridley configuration or any saved data. A response that arrives
 * after a newer run was started is ignored.
 *
 * `snapshot` is whatever the caller wants remembered about the inputs a result
 * was requested with, so a later edit (or a failed re-run) cannot leave an old
 * result looking current.
 */
export function useStatelessCheck<Req, Res, Snapshot = undefined>(
  call: (request: Req) => Promise<Res>,
) {
  const [status, setStatus] = useState<CheckStatus>("idle");
  const [result, setResult] = useState<Res | null>(null);
  const [resultSnapshot, setResultSnapshot] = useState<Snapshot | undefined>();
  const [error, setError] = useState<CheckError | null>(null);
  const runId = useRef(0);

  const run = useCallback(
    async (payload: Req, snapshot?: Snapshot) => {
      const id = ++runId.current;
      setStatus("running");
      setError(null);
      try {
        const evidence = await call(payload);
        if (id !== runId.current) return;
        setResult(evidence);
        setResultSnapshot(snapshot);
        setStatus("done");
      } catch (e) {
        if (id !== runId.current) return;
        setError(toError(e));
        setStatus("error");
      }
    },
    [call],
  );

  const clear = useCallback(() => {
    runId.current++;
    setResult(null);
    setResultSnapshot(undefined);
    setError(null);
    setStatus("idle");
  }, []);

  return { status, result, resultSnapshot, error, run, clear };
}

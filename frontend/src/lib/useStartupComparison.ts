"use client";

import { useCallback, useRef, useState } from "react";
import { ApiError, runStartupCheck } from "./api";
import { RECORDED_STARTUP_CHECK } from "./recorded";
import type { StartupCheckEvidence } from "./types";

export type ComparisonResult = {
  mode: "live" | "recorded";
  baseline: StartupCheckEvidence;
  modified: StartupCheckEvidence;
  /** Live only: baseline and current are the same saved version (latest is v1). */
  sameVersion: boolean;
};

export type ComparisonError = {
  kind:
    | "session"
    | "forbidden"
    | "not_found"
    | "internal"
    | "unavailable"
    | "other";
  message: string;
};

export type ComparisonStatus = "idle" | "running" | "done" | "error";

function toError(error: unknown): ComparisonError {
  if (!(error instanceof ApiError)) {
    return { kind: "other", message: "The test could not be run." };
  }
  if (error.kind === "unauthorized") {
    return {
      kind: "session",
      message:
        "Your demo session has expired, so the live test cannot run. Your configuration and any unsaved edits are untouched.",
    };
  }
  if (error.kind === "forbidden") {
    return {
      kind: "forbidden",
      message:
        "The backend rejected this site's origin for the test request (FRONTEND_ORIGINS does not include it). Nothing was changed.",
    };
  }
  if (error.code === "CONFIGURATION_NOT_FOUND") {
    return {
      kind: "not_found",
      message:
        "A saved version needed for the test was not found in this workspace.",
    };
  }
  if (error.code === "INTERNAL_ERROR") {
    return {
      kind: "internal",
      message:
        "The simulation service hit an internal error. Your configuration is unaffected.",
    };
  }
  if (error.kind === "unavailable") {
    return {
      kind: "unavailable",
      message:
        "The GridProof API is unavailable. Your configuration is unaffected.",
    };
  }
  return { kind: "other", message: error.message };
}

/**
 * Runs the stateless startup check for the baseline (v1) and the latest saved
 * version. It never reads or changes the configuration draft.
 */
export function useStartupComparison() {
  const [status, setStatus] = useState<ComparisonStatus>("idle");
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [error, setError] = useState<ComparisonError | null>(null);
  const runId = useRef(0);

  const run = useCallback(
    async (configurationId: string, latestVersion: number) => {
      const id = ++runId.current;
      setStatus("running");
      setError(null);
      try {
        const sameVersion = latestVersion === 1;
        const [baseline, modified] = await Promise.all([
          runStartupCheck(configurationId, 1),
          sameVersion
            ? Promise.resolve(null)
            : runStartupCheck(configurationId, latestVersion),
        ]);
        if (id !== runId.current) return;
        setResult({
          mode: "live",
          baseline,
          modified: modified ?? baseline,
          sameVersion,
        });
        setStatus("done");
      } catch (e) {
        if (id !== runId.current) return;
        setError(toError(e));
        setStatus("error");
      }
    },
    [],
  );

  const showRecorded = useCallback(() => {
    runId.current++;
    setError(null);
    setResult({
      mode: "recorded",
      baseline: RECORDED_STARTUP_CHECK.baseline,
      modified: RECORDED_STARTUP_CHECK.modified,
      sameVersion: false,
    });
    setStatus("done");
  }, []);

  const clear = useCallback(() => {
    runId.current++;
    setResult(null);
    setError(null);
    setStatus("idle");
  }, []);

  return { status, result, error, run, showRecorded, clear };
}

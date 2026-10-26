"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  getCurrentConfiguration,
  getSession,
  loadCurrentConfiguration,
  saveVersion,
} from "./api";
import type { CurrentConfiguration, SystemConfigV1 } from "./types";

export type LoadPhase = "idle" | "loading" | "ready" | "error";

export type SaveIssue =
  | { kind: "validation"; message: string; fieldErrors: Record<string, string> }
  | { kind: "conflict"; message: string; currentVersion: number | null }
  | { kind: "session"; message: string }
  | { kind: "unavailable"; message: string }
  | { kind: "server"; message: string }
  | { kind: "other"; message: string };

export type SaveStatus = "idle" | "saving" | "saved";

export function sameConfig(a: SystemConfigV1, b: SystemConfigV1): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function describe(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "Something went wrong talking to the GridProof API.";
}

function issueFrom(error: unknown): SaveIssue {
  if (!(error instanceof ApiError)) {
    return { kind: "other", message: describe(error) };
  }
  switch (error.kind) {
    case "validation": {
      const fieldErrors: Record<string, string> = {};
      for (const detail of error.details) {
        // Backend paths look like "snapshot.equipment.g1.startup_delay_s".
        fieldErrors[detail.field.replace(/^(body\.)?(snapshot\.)?/, "")] =
          detail.reason;
      }
      return { kind: "validation", message: error.message, fieldErrors };
    }
    case "conflict":
      return {
        kind: "conflict",
        message: "Another save created a newer version of this configuration.",
        currentVersion: error.currentVersion,
      };
    case "unauthorized":
      return {
        kind: "session",
        message:
          "Your demo session expired. Your edits are still here; start a new session to continue.",
      };
    case "unavailable":
      // The API's own 500 means it is reachable; "unavailable" is for outages.
      if (error.code === "INTERNAL_ERROR") {
        return {
          kind: "server",
          message:
            "The server hit an unexpected error. Your edits are kept; try again.",
        };
      }
      return {
        kind: "unavailable",
        message:
          "The GridProof API is unavailable. Your edits are kept; try again.",
      };
    default:
      return { kind: "other", message: error.message };
  }
}

/** `enabled` defers the session bootstrap until the lab is actually opened. */
export function useWorkspaceConfig(enabled = true) {
  const [phase, setPhase] = useState<LoadPhase>("idle");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [server, setServer] = useState<CurrentConfiguration | null>(null);
  const [draft, setDraft] = useState<SystemConfigV1 | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [issue, setIssue] = useState<SaveIssue | null>(null);

  const applyLoaded = useCallback((loaded: CurrentConfiguration) => {
    setServer(loaded);
    setDraft(loaded.snapshot);
    setPhase("ready");
    setLoadError(null);
  }, []);

  const load = useCallback(async () => {
    setPhase("loading");
    setLoadError(null);
    try {
      applyLoaded(await loadCurrentConfiguration());
    } catch (error) {
      setLoadError(describe(error));
      setPhase("error");
    }
  }, [applyLoaded]);

  const started = useRef(false);
  useEffect(() => {
    if (enabled && !started.current) {
      started.current = true;
      void load();
    }
  }, [enabled, load]);

  const updateDraft = useCallback(
    (update: (current: SystemConfigV1) => SystemConfigV1) => {
      setDraft((current) => (current ? update(current) : current));
      setSaveStatus("idle");
      setIssue((previous) =>
        previous?.kind === "validation" ? null : previous,
      );
    },
    [],
  );

  const dirty =
    server !== null && draft !== null && !sameConfig(server.snapshot, draft);

  const save = useCallback(async () => {
    if (!server || !draft) return;
    const submitted = draft;
    setSaveStatus("saving");
    setIssue(null);
    try {
      const saved = await saveVersion(server.configuration_id, {
        expected_version: server.latest_version,
        name: server.name,
        snapshot: submitted,
      });
      // Confirm the persisted result from the server rather than trusting the POST.
      const confirmed = await getCurrentConfiguration();
      if (confirmed.latest_version !== saved.version_number) {
        throw new ApiError({
          kind: "other",
          status: 0,
          code: "CONFIRMATION_MISMATCH",
          message: `Saved version ${saved.version_number} could not be confirmed (server reports ${confirmed.latest_version}).`,
        });
      }
      setServer(confirmed);
      // Keep edits made while the request was in flight.
      setDraft((current) =>
        current && sameConfig(current, submitted)
          ? confirmed.snapshot
          : current,
      );
      setSaveStatus("saved");
    } catch (error) {
      setSaveStatus("idle");
      setIssue(issueFrom(error));
    }
  }, [server, draft]);

  /** Discard the draft and take the server's current configuration (explicit user action). */
  const reload = useCallback(async () => {
    setIssue(null);
    setSaveStatus("idle");
    try {
      applyLoaded(await loadCurrentConfiguration());
    } catch (error) {
      setIssue(issueFrom(error));
    }
  }, [applyLoaded]);

  /**
   * Explicitly start a new session after expiry. The unsaved draft is kept and
   * becomes an edit on top of the new workspace's configuration.
   */
  const recoverSession = useCallback(async () => {
    setIssue(null);
    try {
      await getSession();
      const fresh = await getCurrentConfiguration();
      setServer(fresh);
      setPhase("ready");
      // draft intentionally untouched
    } catch (error) {
      setIssue(issueFrom(error));
    }
  }, []);

  return {
    phase,
    loadError,
    server,
    draft,
    dirty,
    saveStatus,
    issue,
    retryLoad: load,
    updateDraft,
    save,
    reload,
    recoverSession,
  };
}

"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useFacilities } from "@/lib/useFacilities";
import { useWorkspaceConfig } from "@/lib/useWorkspaceConfig";
import { usePlayback } from "@/lib/usePlayback";
import { useStartupComparison } from "@/lib/useStartupComparison";
import type { Facility } from "@/lib/types";
import FacilityMap from "./map/FacilityMap";
import LabScene from "./lab/LabScene";
import type { AssetId } from "./lab/assets";
import Inspector, { SavePanel } from "./inspector/Inspector";
import ComparePanel, { type Side } from "./compare/ComparePanel";

const LAB_HASH = "#fridley-lab";

function subscribeHash(callback: () => void) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}
const getHash = () => window.location.hash;
const getServerHash = () => "";

function ApiChip({
  state,
}: {
  state: "checking" | "connected" | "unavailable";
}) {
  const label = {
    checking: "Checking API…",
    connected: "API connected",
    unavailable: "API unavailable",
  }[state];
  const color = {
    checking: "bg-gp-warn",
    connected: "bg-gp-ok",
    unavailable: "bg-gp-error",
  }[state];
  return (
    <span
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 text-xs text-gp-muted"
    >
      <span className={`h-2 w-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}

function Header({ right }: { right: React.ReactNode }) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-gp-line px-5 py-3">
      <div className="flex items-baseline gap-3">
        <span className="text-sm font-bold tracking-[0.25em] text-gp-text">
          GRID<span className="text-gp-red">PROOF</span>
        </span>
        <span className="hidden text-xs text-gp-faint sm:inline">
          Virtual Power Integration Workbench
        </span>
      </div>
      {right}
    </header>
  );
}

function Footer() {
  return (
    <footer className="border-t border-gp-line px-5 py-3 text-center text-[11px] leading-relaxed text-gp-faint">
      GridProof is an independent, Cummins-inspired engineering project, not
      affiliated with or endorsed by Cummins Inc. All equipment, configurations
      and values shown are synthetic; no real Cummins operational data is used.
    </footer>
  );
}

export default function AppShell() {
  const hash = useSyncExternalStore(subscribeHash, getHash, getServerHash);
  const inLab = hash === LAB_HASH;
  const [enteringId, setEnteringId] = useState<string | null>(null);
  const [selected, setSelected] = useState<AssetId | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    facilities,
    error: facilitiesError,
    retry: retryFacilities,
  } = useFacilities();
  const ws = useWorkspaceConfig(inLab);
  const comparison = useStartupComparison();
  const [side, setSide] = useState<Side>("modified");
  const playedFrames = comparison.result
    ? comparison.result[side].frames
    : null;
  const playback = usePlayback(playedFrames);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const enterLab = useCallback(
    (facility: Facility) => {
      if (!facility.is_interactive || enteringId) return;
      setEnteringId(facility.id);
      const reduced = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      timer.current = setTimeout(
        () => {
          window.location.hash = LAB_HASH;
          setEnteringId(null);
        },
        reduced ? 0 : 650,
      );
    },
    [enteringId],
  );

  const leaveLab = () => {
    window.location.hash = "";
    history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  };

  const apiState =
    ws.phase === "error" || facilitiesError
      ? "unavailable"
      : (inLab ? ws.phase === "ready" : facilities !== null)
        ? "connected"
        : "checking";

  if (!inLab) {
    return (
      <div className="flex min-h-screen flex-col">
        <Header right={<ApiChip state={apiState} />} />
        <main className="flex-1 px-5 py-6">
          <div className="mx-auto mb-5 max-w-[1200px]">
            <h1 className="text-2xl font-semibold text-gp-text">
              Select a facility
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-gp-muted">
              Public Cummins-related locations, shown as approximate city-level
              markers. Only the Fridley Power Integration Center has an
              interactive virtual lab in this demo.
            </p>
          </div>
          {facilities ? (
            <FacilityMap
              facilities={facilities}
              enteringId={enteringId}
              onEnter={enterLab}
            />
          ) : facilitiesError ? (
            <div
              role="alert"
              className="mx-auto max-w-[1200px] rounded-lg border border-gp-error/40 bg-gp-error/10 p-5 text-sm"
            >
              <p className="font-medium text-gp-error">
                Facility catalog unavailable
              </p>
              <p className="mt-1 text-gp-muted">{facilitiesError}</p>
              <button
                type="button"
                onClick={retryFacilities}
                className="mt-3 rounded border border-gp-line-strong px-3 py-1.5 hover:bg-gp-surface"
              >
                Retry
              </button>
            </div>
          ) : (
            <div className="mx-auto aspect-[1000/423] max-w-[1200px] animate-pulse rounded-xl border border-gp-line bg-gp-surface" />
          )}
        </main>
        <Footer />
      </div>
    );
  }

  const server = ws.server;
  const versionLabel = server ? `v${server.latest_version}` : "—";

  return (
    <div className="gp-lab-in flex min-h-screen flex-col">
      <Header
        right={
          <div className="flex items-center gap-4">
            {server && (
              <span className="rounded border border-gp-line-strong px-2 py-0.5 font-mono text-xs text-gp-text">
                {versionLabel}
                {ws.dirty ? " · unsaved edits" : ""}
              </span>
            )}
            <ApiChip state={apiState} />
          </div>
        }
      />
      <main className="flex-1 px-5 py-5">
        <div className="mx-auto mb-4 flex max-w-[1280px] items-center gap-4">
          <button
            type="button"
            onClick={leaveLab}
            className="rounded-md border border-gp-line-strong px-3 py-1.5 text-sm text-gp-muted hover:bg-gp-surface hover:text-gp-text"
          >
            ← Map
          </button>
          <div>
            <h1 className="text-lg font-semibold text-gp-text">
              Fridley Virtual Power Integration Lab
            </h1>
            <p className="text-xs text-gp-faint">
              Synthetic, Cummins-inspired representation · configured values
              only
            </p>
          </div>
        </div>

        {(ws.phase === "idle" || ws.phase === "loading") && (
          <div
            role="status"
            className="mx-auto max-w-[1280px] rounded-lg border border-gp-line bg-gp-surface p-10 text-center text-sm text-gp-muted"
          >
            Preparing your demo workspace…
          </div>
        )}

        {ws.phase === "error" && (
          <div
            role="alert"
            className="mx-auto max-w-[1280px] rounded-lg border border-gp-error/40 bg-gp-error/10 p-6 text-sm"
          >
            <p className="font-medium text-gp-error">
              Could not load the lab configuration
            </p>
            <p className="mt-1 text-gp-muted">{ws.loadError}</p>
            <button
              type="button"
              onClick={ws.retryLoad}
              className="mt-3 rounded border border-gp-line-strong px-3 py-1.5 hover:bg-gp-surface"
            >
              Retry
            </button>
          </div>
        )}

        {ws.phase === "ready" && ws.draft && server && (
          <div className="mx-auto grid max-w-[1280px] gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="overflow-hidden rounded-xl border border-gp-line bg-gradient-to-b from-gp-surface to-gp-bg p-2">
              <LabScene
                config={ws.draft}
                selected={selected}
                onSelect={setSelected}
                frame={
                  playedFrames && playback.index !== null
                    ? playedFrames[playback.index]
                    : null
                }
                frameCaption={
                  comparison.result
                    ? `${comparison.result.mode === "recorded" ? "RECORDED DEMO PLAYBACK" : "SIMULATED PLAYBACK"} · ${side.toUpperCase()} · EVIDENCE FRAME ${(playback.index ?? 0) + 1}/${playedFrames?.length ?? 0} · NOT LIVE EQUIPMENT DATA`
                    : undefined
                }
              />
            </div>
            <aside
              aria-label="Equipment inspector"
              className="rounded-xl border border-gp-line bg-gp-surface p-5"
            >
              <p className="mb-3 text-[11px] font-semibold tracking-widest text-gp-red uppercase">
                Inspector
              </p>
              <Inspector
                asset={selected}
                config={ws.draft}
                fieldErrors={
                  ws.issue?.kind === "validation" ? ws.issue.fieldErrors : {}
                }
                onChange={ws.updateDraft}
              />
              <SavePanel
                versionLabel={`${server.name} · ${versionLabel}`}
                dirty={ws.dirty}
                saving={ws.saveStatus === "saving"}
                saved={ws.saveStatus === "saved"}
                issue={ws.issue}
                onSave={ws.save}
                onReload={ws.reload}
                onRecover={ws.recoverSession}
              />
            </aside>
          </div>
        )}

        {inLab && (ws.phase === "ready" || ws.phase === "error") && (
          <ComparePanel
            status={comparison.status}
            result={comparison.result}
            error={comparison.error}
            latestVersion={server?.latest_version ?? null}
            sceneAvailable={ws.phase === "ready"}
            blockedReason={
              ws.phase !== "ready" || !server
                ? "The live test needs the backend. Use the recorded demo."
                : ws.saveStatus === "saving"
                  ? "Saving…"
                  : ws.dirty
                    ? "Save or discard your edits first: the test runs on saved versions only."
                    : null
            }
            onRun={() => {
              if (!server) return;
              playback.setIndex(null);
              void comparison.run(
                server.configuration_id,
                server.latest_version,
              );
            }}
            onShowRecorded={() => {
              playback.setIndex(null);
              comparison.showRecorded();
            }}
            onClear={() => {
              playback.setIndex(null);
              comparison.clear();
            }}
            playback={{
              side,
              onSide: (next) => {
                playback.setIndex(null);
                setSide(next);
              },
              index: playback.index,
              playing: playback.playing,
              onIndex: playback.setIndex,
              onPlay: playback.play,
              onPause: playback.pause,
            }}
          />
        )}
      </main>
      <Footer />
    </div>
  );
}

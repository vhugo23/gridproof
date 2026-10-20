"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { experienceFor, DAVENTRY_HASH, MINING_HASH } from "@/lib/experiences";
import { useFacilities } from "@/lib/useFacilities";
import { useWorkspaceConfig } from "@/lib/useWorkspaceConfig";
import { usePlayback } from "@/lib/usePlayback";
import { useStartupComparison } from "@/lib/useStartupComparison";
import type { Facility } from "@/lib/types";
import FacilityMap from "./map/FacilityMap";
import FacilityCard from "./map/FacilityCard";
import IndustryGallery from "./gallery/IndustryGallery";
import Workbench from "./daventry/Workbench";
import DutyCycleWorkbench from "./mining/DutyCycleWorkbench";
import LabScene from "./lab/LabScene";
import type { AssetId } from "./lab/assets";
import ChallengePanel from "./challenges/ChallengePanel";
import type { ChallengeId } from "./challenges/deriveChallenge";
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
    <header className="flex items-center justify-between gap-4 border-b border-gp-line px-5 py-2.5">
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
    <footer className="border-t border-gp-line px-5 py-2 text-center text-[11px] leading-relaxed text-gp-faint">
      GridProof is an independent, Cummins-inspired engineering project, not
      affiliated with or endorsed by Cummins Inc. All equipment, configurations
      and values shown are synthetic; no real Cummins operational data is used.
    </footer>
  );
}

export default function AppShell() {
  const hash = useSyncExternalStore(subscribeHash, getHash, getServerHash);
  const inLab = hash === LAB_HASH;
  const inWorkbench = hash === DAVENTRY_HASH;
  const inMining = hash === MINING_HASH;
  const [enteringId, setEnteringId] = useState<string | null>(null);
  const [activeFacilityId, setActiveFacilityId] = useState("fridley");
  const [selected, setSelected] = useState<AssetId | null>(null);
  const [rightTab, setRightTab] = useState<"inspector" | "results">(
    "inspector",
  );
  const [wide, setWide] = useState(false);
  const [challenge, setChallenge] = useState<ChallengeId | null>(null);
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

  const openLabFrom = (asset: AssetId | null, next?: ChallengeId) => {
    const lab = facilities?.find((f) => f.is_interactive);
    if (!lab) return;
    setChallenge(next ?? null);
    setSelected(asset);
    setRightTab("inspector");
    enterLab(lab);
  };

  // A challenge exists only when launched from an application brief.
  const enterFromMap = (facility: Facility) => {
    setChallenge(null);
    enterLab(facility);
  };

  // Synthetic exercises open by hash like the lab, but need no session or workspace.
  const openExperience = (facility: Facility) => {
    const experience = experienceFor(facility.id);
    if (experience) window.location.hash = experience.hash;
  };

  // Application-brief exercises open by hash too, with no session or workspace.
  const openWorkbench = (hash: string) => {
    window.location.hash = hash;
  };

  const leaveLab = () => {
    setChallenge(null);
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

  if (inMining) {
    return (
      <div className="flex min-h-screen flex-col">
        <Header right={<ApiChip state={apiState} />} />
        <main className="flex-1 px-5 py-3">
          <DutyCycleWorkbench onBack={leaveLab} />
        </main>
        <Footer />
      </div>
    );
  }

  if (inWorkbench) {
    return (
      <div className="flex min-h-screen flex-col">
        <Header right={<ApiChip state={apiState} />} />
        <main className="flex-1 px-5 py-3">
          <Workbench onBack={leaveLab} />
        </main>
        <Footer />
      </div>
    );
  }

  if (!inLab) {
    const facility =
      facilities?.find((f) => f.id === activeFacilityId) ??
      facilities?.[0] ??
      null;
    return (
      <div className="flex min-h-screen flex-col">
        <Header right={<ApiChip state={apiState} />} />
        <main className="flex-1 px-5 py-5">
          <div className="mx-auto max-w-[1280px]">
            <div className="mb-4">
              <p className="text-[11px] font-semibold tracking-[0.2em] text-gp-red uppercase">
                Independent · Cummins-inspired · synthetic data
              </p>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight text-gp-text">
                Explore Power Integration
              </h1>
              <p className="mt-1 max-w-3xl text-sm text-gp-muted">
                Enter a synthetic virtual lab inspired by the Power Integration
                Center in Fridley, Minnesota: configure a power system, run a
                utility-outage startup test and review the evidence. Markers are
                approximate city-level locations. Seymour is informational;
                Daventry offers an independent synthetic generator workbench.
              </p>
            </div>
            {facilities && facility ? (
              <div className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]">
                <FacilityMap
                  facilities={facilities}
                  activeId={facility.id}
                  onActive={setActiveFacilityId}
                  enteringId={enteringId}
                  onEnter={enterFromMap}
                />
                <div className="relative min-h-0">
                  <FacilityCard
                    facility={facility}
                    onEnter={enterFromMap}
                    onOpenExperience={openExperience}
                  />
                </div>
              </div>
            ) : facilitiesError ? (
              <div
                role="alert"
                className="rounded-lg border border-gp-error/40 bg-gp-error/10 p-5 text-sm"
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
              <div className="aspect-[1000/423] animate-pulse rounded-xl border border-gp-line bg-gp-surface" />
            )}
            {facilities && facility && (
              <IndustryGallery
                onOpenLab={openLabFrom}
                onOpenWorkbench={openWorkbench}
              />
            )}
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  const server = ws.server;
  const versionLabel = server ? `v${server.latest_version}` : "—";
  const blockedReason =
    ws.phase !== "ready" || !server
      ? "The live test needs the backend. Use the recorded demo."
      : ws.saveStatus === "saving"
        ? "Saving…"
        : ws.dirty
          ? "Save or discard your edits first: the test runs on saved versions only."
          : null;

  const resultsOutdated =
    comparison.result?.mode === "live" &&
    server !== null &&
    comparison.result.modified.source.version_number !== server.latest_version;

  const runTest = () => {
    if (!server) return;
    playback.setIndex(null);
    setRightTab("results");
    void comparison.run(server.configuration_id, server.latest_version);
  };
  const showRecorded = () => {
    playback.setIndex(null);
    setRightTab("results");
    comparison.showRecorded();
  };

  const results = (
    <ComparePanel
      status={comparison.status}
      result={comparison.result}
      error={comparison.error}
      latestVersion={server?.latest_version ?? null}
      sceneAvailable={ws.phase === "ready"}
      blockedReason={blockedReason}
      onRun={runTest}
      onShowRecorded={showRecorded}
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
  );

  const tabClass = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-sm font-medium transition ${
      active
        ? "bg-gp-red text-white"
        : "text-gp-muted hover:bg-gp-surface-2 hover:text-gp-text"
    }`;

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
      <main className="flex-1 px-5 py-3">
        <div className="mx-auto mb-3 flex max-w-[1280px] flex-wrap items-center gap-x-4 gap-y-2">
          <button
            type="button"
            onClick={leaveLab}
            className="rounded-md border border-gp-line-strong px-3 py-1.5 text-sm text-gp-muted hover:bg-gp-surface hover:text-gp-text"
          >
            ← Map
          </button>
          <div className="mr-auto">
            <h1 className="text-lg leading-tight font-semibold text-gp-text">
              Fridley Virtual Power Integration Lab
            </h1>
            <p className="text-xs text-gp-faint">
              Synthetic, Cummins-inspired representation · not affiliated with
              Cummins Inc.
            </p>
          </div>
          {(ws.phase === "ready" || ws.phase === "error") && (
            <div className="flex flex-col items-end gap-1">
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={runTest}
                  disabled={
                    blockedReason !== null || comparison.status === "running"
                  }
                  className="rounded-md bg-gp-red px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-gp-red/20 transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:bg-gp-line-strong disabled:text-gp-faint disabled:shadow-none"
                >
                  {comparison.status === "running"
                    ? "Running…"
                    : "Run Utility-Outage Test"}
                </button>
                <button
                  type="button"
                  onClick={showRecorded}
                  className="rounded-md border border-gp-line-strong px-3 py-2 text-sm text-gp-muted hover:bg-gp-surface-2 hover:text-gp-text"
                >
                  Show recorded demo
                </button>
              </div>
              {blockedReason && (
                <p
                  className="max-w-sm text-right text-[11px] text-gp-warn"
                  role="status"
                >
                  {blockedReason}
                </p>
              )}
            </div>
          )}
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
          <div className="mx-auto max-w-[1280px] space-y-4">
            <div
              role="alert"
              className="rounded-lg border border-gp-error/40 bg-gp-error/10 p-5 text-sm"
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
            <div className="max-w-xl rounded-xl border border-gp-line bg-gp-surface p-4">
              {results}
            </div>
          </div>
        )}

        {ws.phase === "ready" && ws.draft && server && (
          <div
            className={`mx-auto grid max-w-[1280px] items-start gap-4 ${
              wide
                ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
                : "lg:grid-cols-[minmax(0,2.1fr)_minmax(0,1fr)]"
            }`}
          >
            <div className="overflow-hidden rounded-xl border border-gp-line bg-gradient-to-b from-gp-surface to-gp-bg p-1.5 lg:sticky lg:top-3">
              <LabScene
                config={ws.draft}
                selected={selected}
                onSelect={(id) => {
                  setSelected(id);
                  setRightTab("inspector");
                }}
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
              aria-label="Inspector and test results"
              className="rounded-xl border border-gp-line bg-gp-surface p-3 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto"
            >
              <div
                role="tablist"
                aria-label="Right panel"
                className="mb-3 flex items-center gap-1"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={rightTab === "inspector"}
                  onClick={() => setRightTab("inspector")}
                  className={tabClass(rightTab === "inspector")}
                >
                  Inspector
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={rightTab === "results"}
                  onClick={() => setRightTab("results")}
                  className={tabClass(rightTab === "results")}
                >
                  Test results
                  {comparison.result
                    ? resultsOutdated
                      ? " · outdated"
                      : " ●"
                    : ""}
                </button>
                {rightTab === "results" && (
                  <button
                    type="button"
                    aria-pressed={wide}
                    onClick={() => setWide((w) => !w)}
                    className="ml-auto hidden rounded border border-gp-line-strong px-2 py-1 text-[11px] text-gp-muted hover:bg-gp-surface-2 lg:block"
                  >
                    {wide ? "Narrow" : "Wide"} view
                  </button>
                )}
              </div>
              {challenge && (
                <ChallengePanel
                  key={challenge}
                  challenge={challenge}
                  server={server}
                  draft={ws.draft}
                  dirty={ws.dirty}
                  result={comparison.result}
                  runStatus={comparison.status}
                  runBlockedReason={blockedReason}
                  onChangeDraft={ws.updateDraft}
                  onOpenInspector={() => {
                    setSelected(challenge === "g1-startup" ? "g1" : "load");
                    setRightTab("inspector");
                  }}
                  onDismiss={() => setChallenge(null)}
                />
              )}
              {rightTab === "inspector" ? (
                <div className="px-1">
                  <Inspector
                    asset={selected}
                    config={ws.draft}
                    fieldErrors={
                      ws.issue?.kind === "validation"
                        ? ws.issue.fieldErrors
                        : {}
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
                </div>
              ) : (
                <div className="px-1">{results}</div>
              )}
            </aside>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}

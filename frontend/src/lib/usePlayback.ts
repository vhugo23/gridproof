"use client";

import { useCallback, useEffect, useState } from "react";
import type { EvidenceFrame } from "./types";

/**
 * Steps through the evidence frames of one result. `index` is null while the scene
 * shows the configured values. Frames are discrete state snapshots; playback only
 * moves between them and never interpolates or computes anything.
 */
export function usePlayback(frames: EvidenceFrame[] | null) {
  const [index, setIndexState] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const count = frames?.length ?? 0;

  const setIndex = useCallback(
    (next: number | null) => {
      setPlaying(false);
      setIndexState(
        next === null ? null : Math.max(0, Math.min(count - 1, next)),
      );
    },
    [count],
  );

  const play = useCallback(() => {
    if (count === 0) return;
    setIndexState((current) =>
      current === null || current >= count - 1 ? 0 : current,
    );
    setPlaying(true);
  }, [count]);

  const pause = useCallback(() => setPlaying(false), []);

  useEffect(() => {
    if (!playing || !frames || index === null) return;
    if (index >= frames.length - 1) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- stop at the last frame
      setPlaying(false);
      return;
    }
    // Frames at the same instant pass quickly; separate instants get a readable beat.
    const sameInstant = frames[index + 1].at_ms === frames[index].at_ms;
    const timer = setTimeout(
      () => setIndexState(index + 1),
      sameInstant ? 350 : 1100,
    );
    return () => clearTimeout(timer);
  }, [playing, index, frames]);

  return { index, playing, setIndex, play, pause };
}

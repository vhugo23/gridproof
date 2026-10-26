"use client";

import { runMobilePower } from "./api";
import type { MobilePowerEvidence, MobilePowerRequest } from "./types";
import { useStatelessCheck } from "./useStatelessCheck";

/** The form text a result was requested with, so a later edit can be flagged. */
export type MobilePowerSnapshot = {
  rows: Array<{
    key: number;
    name: string;
    qty: string;
    kw: string;
    sim: string;
  }>;
  margin: string;
};

/** Runs the stateless Mobile-Site Power Planner screening (API-19). */
export function useMobilePower() {
  return useStatelessCheck<
    MobilePowerRequest,
    MobilePowerEvidence,
    MobilePowerSnapshot
  >(runMobilePower);
}

"use client";

import { runDutyCycle } from "./api";
import type { DutyCycleEvidence, DutyCycleRequest } from "./types";
import { useStatelessCheck } from "./useStatelessCheck";

/** The form text a result was requested with, so a later edit can be flagged. */
export type DutyCycleSnapshot = {
  rows: Array<{ key: number; name: string; kw: string; min: string }>;
  cycles: string;
};

/** Runs the stateless Mining duty-cycle analysis (API-18). */
export function useDutyCycle() {
  return useStatelessCheck<
    DutyCycleRequest,
    DutyCycleEvidence,
    DutyCycleSnapshot
  >(runDutyCycle);
}

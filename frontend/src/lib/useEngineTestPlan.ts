"use client";

import { runEngineTestPlan } from "./api";
import type { EnginePlanEvidence, EnginePlanRequest } from "./types";
import { useStatelessCheck } from "./useStatelessCheck";

/** The form text a result was requested with, so a later edit can be flagged. */
export type EnginePlanSnapshot = {
  objective: string;
  requirements: Array<{
    key: number;
    label: string;
    rpmMin: string;
    rpmMax: string;
    torqueMin: string;
    torqueMax: string;
    power: string;
    minPoints: string;
    minDwell: string;
  }>;
  points: Array<{
    key: number;
    label: string;
    rpm: string;
    torque: string;
    dwell: string;
  }>;
};

/** Runs the stateless Seymour Engine Test-Plan coverage check (API-20). */
export function useEngineTestPlan() {
  return useStatelessCheck<
    EnginePlanRequest,
    EnginePlanEvidence,
    EnginePlanSnapshot
  >(runEngineTestPlan);
}

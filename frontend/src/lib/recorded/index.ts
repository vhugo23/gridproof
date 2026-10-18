import type { StartupCheckEvidence } from "../types";
import fixture from "./startup-check-5s-vs-15s.json";

// Recorded demo fallback. The fixture is generated from the backend simulator
// (backend/tests/test_recorded_fixture.py fails if it drifts). It is shown only
// behind an explicit "recorded" label and is never presented as a live run.
export const RECORDED_STARTUP_CHECK = fixture as unknown as {
  recorded: true;
  generated_by: string;
  baseline: StartupCheckEvidence;
  modified: StartupCheckEvidence;
};

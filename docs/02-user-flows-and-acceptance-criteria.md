# GridProof — User Flows and Acceptance Criteria

**Document:** `docs/02-user-flows-and-acceptance-criteria.md`  
**Version:** 1.2 (clarifies PDF priority and facility count)  
**Date:** October 17, 2026  
**Status:** Approved user-flow decisions; ready for system architecture  
**Source of truth:** [`01-product-requirements.md`](./01-product-requirements.md), version 1.1  
**Product:** GridProof — Virtual Power Integration & Commissioning Workbench

> **Product boundary:** GridProof is an **independent, Cummins-inspired prototype**, not an official Cummins product. Real facility names are public context; equipment arrangements, operating values, scenarios, and results are **synthetic**. The simulator does **not** certify, commission, or operate real electrical systems.

## 1. Purpose and decisions already locked

This document specifies **what users see, do, and receive**, before determining backend services, database tables, or API endpoints. A feature is complete only when the stated acceptance criteria pass. The PRD remains authoritative if a conflict appears; resolve the conflict explicitly rather than silently redefining scope.

| Area | Approved decision | Consequence |
|---|---|---|
| First screen | **Geographic map** | Visitors select facilities before entering a lab |
| Operating workspace | **Fridley-inspired virtual PIC only** | Seymour and Daventry show public-context information, not live operations; Daventry also offers an independent synthetic workbench |
| Visualization | **Hybrid: 2.5D site + focused 3D inspector** | Clickable physical assets; static image/text fallback for missing models or WebGL |
| Brand | **Independent GridProof** | Notice of non-affiliation and synthetic results in app/report; no official Cummins app shell |
| AI | **Optional Gemini test drafting** | Human review, deterministic validation, explicit confirmation; manual tests always work |
| Computation | **Deterministic discrete-event simulation** | Recorded events and assertions, not scripted animation or AI-generated outcomes |
| Persistence | **Server-side** | Save configuration versions, scenarios and immutable simulation runs on the server; reload across refreshes |
| Evidence export | **PDF required** | Download a report generated from a persisted run snapshot (implementation priority P1; required for the finished showcase) |
| Showcase | **Generator G1 startup-delay regression** | Compare verified baseline and increased startup delay; assert G1 readiness deadline independently of critical-load continuity |

### Priority definitions

- **P0 / release-blocking:** Necessary to complete the core end-to-end demo safely and truthfully.
- **P1 / strong MVP:** In the approved PRD scope and important for a polished engineering showcase; should ship after P0 correctness is secure.
- **P2 / optional:** May be omitted without preventing the core MVP from working, including live Gemini access.
- **Later / excluded:** Out of scope for this release.

**MVP release gate:** All P0 criteria must pass, and the shipped subset of P1 must pass its criteria. Unimplemented P1/P2 controls must be hidden or explicitly labeled unavailable—never rendered as working buttons without behavior.

## 2. Navigation and screen map

```text
/   Geographic Cummins-context facility map
│
├── Select Fridley ──> Facility card ──> Enter Virtual Lab
│                                            │
│                                            v
│                                     /lab/fridley
│                                      ├── Physical site / asset inspector
│                                      ├── Configuration / single-line diagram
│                                      ├── Test scenarios / manual authoring
│                                      ├── Simulation / replay / evidence
│                                      ├── Run comparison
│                                      ├── Report export
│                                      └── (Optional) AI draft test
│
├── Select Seymour ──> Informational facility card only
└── Select Daventry ──> Facility card (public context) + Open Synthetic Workbench ──> UF-01a
```

Routes are **navigation concepts**, not mandated implementation URLs other than `/` as the default landing route. Navigation must preserve context where reasonably possible. Do not create a simulated operations screen for informational-only locations.

## 3. Canonical end-to-end user flow — showcase path (UF-00, P0)

**Actor:** Visitor acting as an integration engineer.  
**Goal:** Demonstrate a configuration change causing an observable, explainable acceptance-test outcome.  
**Precondition:** Public demo is loaded, without private credentials or Gemini dependency.

1. User opens GridProof and sees a **geographic facility map**, independent-product disclosure, and the three verified location markers.
2. User selects **Fridley, MN**. A facility card distinguishes the real Power Integration Center from the **fictional virtual lab**.
3. User clicks **Enter Virtual Lab**. A virtual facility opens with a 2.5D equipment view and a seeded, clearly labeled synthetic system.
4. User clicks **Generator G1**. Its highlighted marker and inspector show a consistent ID, 250 kW nameplate capacity, simulated state, and editable startup delay.
5. User selects the seeded **G1 startup-delay regression** test, which includes a utility outage, a G1 ready-by deadline, and an independent critical-load-continuity assertion.
6. User runs an **unchanged baseline** and sees a computed event trace with assertion results. This run becomes the baseline for comparison.
7. User increases G1 startup delay from the seeded baseline **5 s to 15 s**; the app validates and saves a **new server-persisted configuration version**. These are synthetic demonstration inputs, not Cummins equipment timing specifications.
8. User reruns the same test. The simulator uses the updated inputs and produces a **new immutable run**; expected fixture labels do not substitute for the result.
9. User selects a failed or changed assertion, inspects its measured value and threshold, and scrubs the timeline. The physical scene, electrical diagram, chart, and event list agree at that timestamp.
10. User compares baseline and modified runs and sees the changed inputs, events, timings and assertion outcomes.
11. User downloads a **PDF evidence report** generated from the saved run snapshot, containing configuration, traceable findings, simulation limitations, and non-affiliation disclosures.
12. User can return to the map or the lab without accidentally modifying completed run records.

**Successful outcome:** A visitor can explain **what changed, what the simulator calculated, and why a requirement passed or failed**, without claiming a real facility has been tested.

**Flagship fixture rule:** The seeded scenario shall explicitly require **G1 to become available within 10 s** after its start command. The baseline input is **5 s** and the changed input is **15 s**. The simulator must compute the timestamps; the first run should satisfy that **G1-specific readiness assertion**, and the second should fail it. A separate **critical-load continuity assertion** must still be evaluated from connected sources and their power limits; it may pass in both runs. Do not claim an outage or critical-load failure just because G1 starts late. These are synthetic acceptance thresholds, not actual Cummins specifications.

**Acceptance criteria — UF-00**

- **AC-UF00-01 [P0]:** Given a fresh deployment, when the visitor follows map → Fridley → lab → scenario → simulation → result, then every step is functional without Gemini or Cummins credentials.
- **AC-UF00-02 [P0]:** Given a baseline and modified configuration, when the same scenario is run, then two distinct run records retain their actual inputs, ordered events and computed assertion outcomes.
- **AC-UF00-03 [P0]:** Given an observed assertion failure, when the user opens it, then they can identify the rule, threshold, measured value, configuration version and relevant events.
- **AC-UF00-04 [P0]:** Given identical saved configuration and scenario inputs, when executed twice, then trace and assertion results match exactly under the documented deterministic settings.
- **AC-UF00-05 [P1]:** Given two completed runs, when selected for comparison, then changed inputs, timing differences, outcomes, and report references are correctly displayed.
- **AC-UF00-06 [P1]:** Given a completed run, when the user exports a **PDF**, then the file opens successfully and faithfully represents the selected persisted run rather than a current unsaved edit.
- **AC-UF00-07 [P0]:** Given the seeded G1 startup fixture, when 5 s and 15 s delays are executed against the same 10 s readiness assertion, then the readiness result changes from pass to fail based on computed event timestamps, while the separately computed load-continuity result remains truthful.

## 4. Detailed feature flows and completion criteria

### UF-01 — Discover a facility on the map (P0)

**Entry:** Navigate to `/` or select **Back to Map**.  
**Main path:** View map → select marker → map focuses selection → details panel opens → choose available action.  
**Inputs:** Location selection; optional zoom/pan.  
**Output:** Public-context facility card with city/country, site purpose, source/attribution information, and capability badge.

**Branches:**

- **Fridley:** **Enter Virtual Lab** opens synthetic PIC-inspired workspace.
- **Seymour:** **View Facility Context** stays informational. No “live status,” control panel, or editable fake plant data.
- **Daventry:** the card keeps the real site's factual public description under “About the real site” and adds a separate, clearly labeled **Open Synthetic Workbench** entry (UF-01a). *Amended 2026-10-19 (D-24, D-27).* It offers no live status, plant control or official product selection.
- **Map tiles unavailable:** Show accessible fallback list with exactly the same facility-selection/navigation capability. Map may be unavailable, but the product is navigable.

**Acceptance criteria**

- **AC-UF01-01 [P0]:** Given a new session, when GridProof opens, then a geographic map is the default experience and the Fridley, Seymour and Daventry entries are available.
- **AC-UF01-02 [P0]:** Given a facility marker, when activated by mouse, keyboard or supported touch, then its corresponding detail card opens and the selected location is distinguishable without color alone.
- **AC-UF01-03 [P0]:** Given Fridley is selected, when **Enter Virtual Lab** is clicked, then Fridley's virtual lab opens without showing data for any other location.
- **AC-UF01-04 [P0]:** Given Seymour is selected, when its card opens, then only informational context is shown, without a functional lab launch. Given Daventry is selected, when its card opens, then the factual public description appears under “About the real site”, a separate synthetic-workbench entry is clearly labeled independent and synthetic, and no Fridley lab launch or session is offered (amended 2026-10-19, D-24 and D-27).
- **AC-UF01-05 [P0]:** Given any facility card, when viewed, then a user can distinguish real verified site context from synthetic operational examples, with independent-project disclosure.
- **AC-UF01-06 [P1]:** Given unavailable external map tiles, when the map fails to render, then a facility list still allows selection and Fridley lab entry; failure is explained instead of a blank screen.

### UF-01a — Screen a customer load in the Daventry synthetic workbench (conference slice, added 2026-10-19)

**Entry:** select Daventry on the map, then **Open Synthetic Workbench** (`#daventry-workbench`; also reachable by address). No session, workspace or Fridley data is involved.
**Inputs:** real power demand (kW), power factor, optional capacity margin (%). The backend validates all of them (API-17).
**Output:** calculated demand, four fixed synthetic packages, and for each package a separate PASS or FAIL for real power (kW) and for apparent power (kVA) with required value, package rating, margin and a server-written explanation. No overall winner, ranking or recommendation.

- **AC-UFD-01 [P1]:** Given Daventry is selected, when the card opens, then it offers the workbench under a synthetic label and shows the real site's description separately; Seymour is unchanged and Fridley still opens its lab.
- **AC-UFD-02 [P1]:** Given valid inputs, when the check runs, then each of the four packages shows two separate verdicts, the demand values, the package ratings, the margins and an explanation, all taken from the server response.
- **AC-UFD-03 [P1]:** Given inputs exactly on a package rating, then the requirement passes with a margin of 0.00; one unit over, it fails. Verdicts do not depend on binary floating-point rounding.
- **AC-UFD-04 [P1]:** Given invalid inputs (range, whole-number, decimal-place or type violations), then the server rejects them and the form shows each field's reason without losing what was typed.
- **AC-UFD-05 [P1]:** Given an unavailable API, then a clear retry state appears and nothing else in GridProof changes.
- **AC-UFD-06 [P1]:** Given any result, then the page states that packages and results are synthetic, independent of the plant and of Cummins Inc., and not a product recommendation, plant operation, complete sizing or compliance check, or measured performance.
- **AC-UFD-07 [P1]:** Given the workbench is used, then no session cookie is set, no `/session` or `/configurations` request is made, and the Fridley configuration and simulator are untouched.
- **AC-UFD-08 [P1]:** Given keyboard or screen-reader use or a 390 px viewport, then every control is reachable, PASS and FAIL appear as text as well as colour, completion is announced politely and there is no horizontal page scroll.

### UF-02 — Enter and explore the 2.5D virtual lab (P0)

**Entry:** **Enter Virtual Lab** for Fridley.  
**Main path:** Load representative site → view selected/default equipment → click a hotspot or card → see asset inspector → select another asset.  
**Seeded classes:** Generator G1/G2, battery system, switchgear/breakers, utility connection, critical load and adjustable load bank.

**Data displayed for selected asset:** ID, category, representative render/model name, configured capacity where relevant, current **simulated** state, and allowed parameters. No claims of exact Fridley installations.

**Branches:**

- **Licensed GLB/glTF available and WebGL works:** Open focused orbit/zoom 3D inspector.
- **WebGL/model fails or is not licensed:** Show bundled static visual with the same textual details and controls.
- **Replay active:** Selected asset state follows replay time; base configuration values remain distinguishable from recorded run values.

**Acceptance criteria**

- **AC-UF02-01 [P0]:** Given a loaded lab, when the site appears, then at least five required equipment classes are represented by selectable labeled visuals.
- **AC-UF02-02 [P0]:** Given G1 is selected, when viewed in the site canvas, card and inspector, then every instance refers to the same asset ID and configured/simulated values.
- **AC-UF02-03 [P0]:** Given an asset selected using the keyboard-accessible equipment list, when opened, then the same information is available as via the visual hotspot.
- **AC-UF02-04 [P1]:** Given a suitable licensed 3D model, when **Inspect 3D** is invoked, then the user can inspect that model without losing selection context.
- **AC-UF02-05 [P1]:** Given unavailable WebGL or a failed model load, when inspection opens, then a bundled static asset and complete text details replace 3D without blocking configuration or testing.
- **AC-UF02-06 [P0]:** Given any asset in the scene, when product context is shown, then it is clearly marked **representative/illustrative** rather than a verified real-installed piece of equipment.

### UF-02a — Guided challenges from Industry Applications (conference slice, added 2026-10-19)

Two optional challenges launch from the Power generation and Battery storage briefs into the Fridley lab and show a compact expandable panel above the Inspector/Results content. A normal map-to-lab entry shows no panel. Both use the visitor's real workspace, saved versions and the existing startup check (no new endpoint).

- **AC-UFG-01 [P1]:** Given a challenge is launched, then no draft or saved version changes until the visitor clicks a preset (draft only) and later saves explicitly; unrelated unsaved edits survive.
- **AC-UFG-02 [P1]:** Given the G1 challenge, then progress is derived from the draft, the latest saved version and fresh live evidence (configure above 10 s, save, run, inspect the failed readiness requirement, optional repair at 10 s or less); a saved version that already qualifies needs no new save, and no start from v1 or 5 s is assumed.
- **AC-UFG-03 [P1]:** Given the battery challenge, then the visitor prepares and saves a load above the inverter limit, locks a prediction for that configuration version, and sees the explanation only after a live run that finished after the prediction.
- **AC-UFG-04 [P1]:** Given recorded-demo playback, a result for another version or workspace, or evidence older than the prediction, then challenge progress does not advance.
- **AC-UFG-05 [P1]:** Given any challenge text, then every number and pass/fail status shown comes from backend evidence, and the panel states the model's simplifications and that all values are synthetic.
- **AC-UFG-06 [P1]:** Given keyboard or screen-reader use or a 390 px viewport, then the panel is operable, announces step changes politely, marks the current step with `aria-current="step"`, and causes no horizontal page scroll.

### UF-03 — Configure the virtual electrical system (P0)

**Entry:** Fridley lab → **Configure** or edit in the selected asset inspector.  
**Main path:** Load seeded configuration → adjust supported values → validate → save version → use version in a scenario.  
**Seed values:** G1 and G2 each 250 kW; BESS 250 kW inverter / 500 kWh usable; utility source; switchgear/breakers; 180 kW critical load; adjustable load bank.

**Supported parameter examples:** G1/G2 startup delay, simulated failure toggles, load level, battery initial SOC, accepted restoration deadline, and scenario-specific faults. System may expose other parameters only if the simulator really consumes them.

**Branches:**

- **Invalid edit:** Inline explanation; cannot save or run invalid snapshot.
- **Unsaved edits before navigation or executing a run:** Preserve draft and request a clear save/discard/cancel choice; never silently run an old snapshot while showing edited values.
- **Previously completed run:** Remains linked to its original immutable configuration, even after new edits.

**Acceptance criteria**

- **AC-UF03-01 [P0]:** Given seeded Fridley config, when loaded, then every user-facing nameplate and parameter matches the approved synthetic fixture.
- **AC-UF03-02 [P0]:** Given a supported parameter, when changed to a valid value and saved, then a new version is selectable for future runs.
- **AC-UF03-03 [P0]:** Given negative capacity, SOC outside 0–100%, missing/unknown asset, or unsupported value, when validated, then save/run is blocked and the problematic field is identified.
- **AC-UF03-04 [P0]:** Given unsaved edits, when a run is requested, then the user is prompted to save the draft or explicitly discard edits; no ambiguous version is executed.
- **AC-UF03-05 [P0]:** Given an old run, when a new configuration is saved, then replaying/exporting the old run still uses its original configuration.
- **AC-UF03-06 [P1]:** Given an electrical diagram, when selected breakers/assets or their states change, then schematic connectivity and selected-asset detail remain consistent with the chosen configuration or replay state.

### UF-04 — Select and manually author tests (P0)

**Entry:** **Test Scenarios** in Fridley lab.  
**Main path:** Browse six seeded scenarios → select scenario → inspect assumptions/events/assertions → edit allowed fields or start manual draft → validate → confirm → run.

**Seeded scenarios:** (1) normal operation, (2) utility outage, (3) generator start failure, (4) breaker fails to close, (5) battery depletion, (6) load exceeds available support.

**Branches:** Unsupported event, invalid asset, contradictory time/value, missing mandatory assertion → actionable error, not silent correction. Canceling a draft retains the approved scenario unchanged.

**Acceptance criteria**

- **AC-UF04-01 [P0]:** Given the test catalog, when opened, then all six required templates appear with purpose, supported events and assertions.
- **AC-UF04-02 [P0]:** Given any template, when the user edits permitted fields, then independent validation runs before the test is eligible to execute.
- **AC-UF04-03 [P0]:** Given an unsupported event or nonexistent asset reference, when validated, then the authoring UI explains the error and blocks execution.
- **AC-UF04-04 [P0]:** Given Gemini is unavailable, when a user authors a valid manual test, then validation, confirmation and execution remain fully operational.
- **AC-UF04-05 [P0]:** Given a canceled edit, when returning to the scenario catalog, then the saved test remains unchanged.

### UF-05 — Run a deterministic integration test (P0)

**Entry:** Validated scenario + saved configuration.  
**Main path:** Review selected config/version and scenario → press **Run Simulation** → execute state-machine/event-queue model → see execution status → view trace, metrics and assertions.

**Simulator responsibilities:** Generator start/trip/failure states; utility availability; breakers and electrical-path connectivity; simplified source allocation; battery inverter/energy limits and SOC; delivered vs unserved critical load; applicable restoration timing.

**Branches:**

- **Input invalid:** Do not execute; show validation issues.
- **Simulation error:** Mark run **Error**, preserve technical diagnostic ID and actionable UI message; do not show a misleading Pass/Fail.
- **Repeated identical inputs:** Same ordered event/metric/assertion result in deterministic test harness.

**Acceptance criteria**

- **AC-UF05-01 [P0]:** Given valid inputs, when **Run Simulation** is pressed, then a new run is created with configuration version, scenario identity, actual inputs and computed results.
- **AC-UF05-02 [P0]:** Given an open breaker path, when a generator is running, then its power does not count as delivered through that path.
- **AC-UF05-03 [P0]:** Given battery-only supply below critical demand, when simulated, then delivered power never exceeds inverter and remaining-energy limits, and unserved load is recorded.
- **AC-UF05-04 [P0]:** Given a battery-depletion test, when energy reaches the lower modeled bound, then SOC remains within the valid range and load shortfall is captured.
- **AC-UF05-05 [P0]:** Given any of six catalog tests, when executed, then a real calculated trace, metrics and assertion evaluation are returned; expected fixture classifications are not substituted for results.
- **AC-UF05-06 [P0]:** Given identical input records, when run twice under the documented deterministic environment, then serialized event traces and assertion outputs match.
- **AC-UF05-07 [P0]:** Given a simulator exception, when surfaced, then the run has an explicit Error status and no fabricated computed conclusion.
- **AC-UF05-08 [P0]:** Given the published benchmark setup, when each seeded scenario is timed, then run duration is **≤ 5 seconds** excluding rendering and AI; record actual measurements and deployment tier.

### UF-06 — Investigate results and replay the same recorded state (P0/P1)

**Entry:** Completed run from test execution or run history.  
**Main path:** Review summary → select assertion → inspect observed value/threshold and evidence events → play/pause/scrub timeline → inspect physical and electrical states.

**Result semantics:** **Pass** (all applicable assertions pass), **Fail** (one or more fail), **Error** (run did not complete properly); optionally **Not evaluated** for an assertion whose prerequisite never occurred. Never call a failing commissioning test “system ready.”

**Acceptance criteria**

- **AC-UF06-01 [P0]:** Given completed run, when results open, then the user sees calculated load demand, connected available generation, delivered/unserved load, SOC, and restoration time where applicable.
- **AC-UF06-02 [P0]:** Given an assertion, when opened, then its requirement ID, pass/fail status, observed value, threshold, configuration version, run ID and relevant timestamps/events are visible.
- **AC-UF06-03 [P0]:** Given expected fixture labels, when viewing actual outcomes, then expected and computed outcomes are visibly distinguished.
- **AC-UF06-04 [P1]:** Given completed run and a selected replay timestamp, when the user scrubs, then site scene, single-line diagram, chart and event list all derive from the *same recorded simulation state*.
- **AC-UF06-05 [P1]:** Given replay is paused and a different asset is selected, when its inspector opens, then it shows that asset at the paused simulated timestamp.
- **AC-UF06-06 [P0]:** Given an unsuccessful run execution, when results are requested, then errors are identified as errors and missing values are not backfilled with guessed metrics.

### UF-07 — Compare before/after test runs (P1)

**Entry:** Two completed runs or saved configuration snapshots.  
**Main path:** Choose baseline and comparison → inspect changed inputs → compare calculated outcomes and assertion deltas → jump to either run for replay.

**Acceptance criteria**

- **AC-UF07-01 [P1]:** Given two completed runs, when compared, then each is identified by run ID, scenario ID and configuration version.
- **AC-UF07-02 [P1]:** Given modified G1 startup delay, when comparing, then the exact input change and any computed timing/pass-fail differences are shown; unchanged outcomes remain unchanged.
- **AC-UF07-03 [P1]:** Given different scenario definitions, when a direct metric comparison would be invalid, then the UI labels the incompatibility rather than asserting improvement.
- **AC-UF07-04 [P1]:** Given a comparison, when the user opens either run, then that run's original evidence and configuration are displayed.

### UF-08 — Export an engineering evidence packet (P1)

**Entry:** Completed run → **Export Report**.  
**Main path:** Select completed persisted run → preview included evidence → generate/download **PDF** → inspect report offline.

**Required content:** Independent-prototype disclosure, project/facility context, configuration snapshot/version, scenario inputs, stated assumptions, acceptance requirements, recorded event sequence, computed metrics, assertion results, run ID, and limitations. Report is a **simulation evidence packet**, not commissioning authorization.

**Acceptance criteria**

- **AC-UF08-01 [P1]:** Given a completed persisted run, when export succeeds, then the downloaded file is a valid **PDF** and contains all required content.
- **AC-UF08-02 [P1]:** Given edits made after the selected run, when exported, then the report reflects the selected run's saved inputs and recorded results rather than newer edits.
- **AC-UF08-03 [P1]:** Given a failed assertion, when reported, then its observed/threshold values and trace references are included.
- **AC-UF08-04 [P1]:** Given any report, when reviewed, then it states that simulation is simplified, cannot certify actual electrical installations, and is not Cummins-affiliated.
- **AC-UF08-05 [P1]:** Given report generation failure, when the download is attempted, then the user receives an actionable error and remains able to review the in-app results.
- **AC-UF08-06 [P1]:** Given a run ID, when a PDF is regenerated later, then it uses the original immutable server-side run/configuration snapshot even if the editable configuration has since changed.
- **AC-UF08-07 [P1]:** Given PDF export, when opened in a standard PDF reader, then the text, tables, timestamps, assertion results and disclosures are legible without relying on client-side web fonts or scripts.

### UF-09 — Draft a test using optional Gemini (P2)

**Entry:** Test Scenarios → **Draft with AI**.  
**Main path:** User writes plain-language request → explicitly chooses **Generate Draft** → server-side Gemini request (if available) → structured draft returned → app validates fields/rules → user reviews/edits → user explicitly confirms → scenario becomes eligible to run.

**Never:** Send automated background prompts, continuously poll Gemini, let AI calculate power-system metrics, or execute drafts automatically.

**Branches:**

- **Quota/rate limit/API error:** Preserve user's prompt and manual draft fields; show **Continue Manually** and editable sample templates.
- **Malformed or unsupported AI output:** Clearly flag invalid fields, require correction and validation; never silently execute.
- **Canceled AI draft:** Do not overwrite approved saved scenario or start a run.

**Acceptance criteria**

- **AC-UF09-01 [P2]:** Given AI is enabled, when a user explicitly submits a request, then at most the intended user-triggered drafting attempt occurs; no request is made on page load, replay or normal test execution.
- **AC-UF09-02 [P2]:** Given a valid structured AI draft, when displayed, then the user can inspect and edit proposed events, asset references, timing and assertions before confirmation.
- **AC-UF09-03 [P2]:** Given an invalid AI draft, when validation runs, then execution remains blocked until edits produce a valid schema and the user confirms.
- **AC-UF09-04 [P2]:** Given an API error or exhausted quota, when the request fails, then prompt/manual inputs remain intact and the manual flow still works.
- **AC-UF09-05 [P2]:** Given the AI-created draft, when the user rejects/cancels it, then no saved approved scenario is modified and no simulation runs.
- **AC-UF09-06 [P0, independent of AI integration]:** Given a bundled example scenario, when Gemini is disabled, then the user can edit, validate and execute it with no external model call.

### UF-10 — Return, refresh and recover (P0/P1)

**Entry:** Any screen, navigation or reload.  
**Main path:** Return to map/lab, reopen saved config or run, continue work.  
**Notes:** Completed run evidence and saved configuration versions are **persisted on the server** and remain available after page refresh. User accounts and cross-user sharing are **not** required for MVP. The architecture must define a bounded anonymous demo workspace/session identifier, retention period and access isolation without storing secrets in the browser.

**Acceptance criteria**

- **AC-UF10-01 [P0]:** Given unsaved configuration/test edits, when navigating away, then a save/discard/cancel decision prevents accidental silent loss.
- **AC-UF10-02 [P0]:** Given a completed run and its server-side workspace identifier, when the browser reloads and reopens that run, then the saved inputs, ordered events and results remain unchanged.
- **AC-UF10-05 [P0]:** Given a successful save, when the server acknowledges it, then subsequent reads return the saved configuration/scenario version; a failed save must not be reported as successful.
- **AC-UF10-06 [P0]:** Given two different demo workspace identifiers, when a user lists or loads saved runs, then records from the other workspace are not exposed through ordinary application navigation or guessed run IDs.
- **AC-UF10-07 [P0]:** Given a completed run, when new edits or subsequent runs are saved, then that completed run remains immutable.
- **AC-UF10-03 [P0]:** Given a temporary UI/rendering failure, when the user accesses the asset list or other fallback control, then the core configuration/scenario flow remains reachable.
- **AC-UF10-04 [P1]:** Given a map-tile failure, when returning to the landing page, then the accessible facility list offers navigation to Fridley.

## 5. Cross-cutting acceptance and UX rules

### UX-01 — Visible system truth (P0)

- Simulated **run states** (Running, Starting, Failed, Open, Closed, etc.) are distinct from **test outcomes** (Pass, Fail, Error).
- Site metrics never use an unlabeled “Live Cummins” or actual-facility operational status.
- Any target uptime, claimed energy saving, environmental impact or regulatory compliance must be removed unless computed from documented model inputs and clearly labeled as simulation output; regulatory certification is not supported.
- Equipment picture/model and rendered specs must not falsely identify an illustrative asset as an exact installed Cummins unit.

### UX-02 — Loading, empty and error states (P0)

- During simulation, show one clear execution state; prevent accidental duplicate submission or differentiate deliberate repeated runs.
- Invalid input messages identify what needs correction; failed jobs expose Error, not invented pass/fail.
- If there is no completed run, show instructions to select/run a scenario rather than fabricated charts.
- If AI is unavailable, the AI area explains this and points to manual authoring without disabling core actions.

### UX-03 — Accessibility (P0)

- Main controls are keyboard operable; markers have an accessible list alternative.
- Pass/fail and equipment statuses use text/icons as well as color.
- Form fields, hotspots and charts have readable labels/text alternatives.
- The prototype remains usable at desktop widths **1280 px and above**; narrower screens get usable navigation/fallbacks without promising full mobile 3D editing.

### UX-04 — Consistent state and provenance (P0)

- Every result links to the precise saved **configuration version + scenario + run ID**.
- Physical diagram, electrical schematic and plots read from the same recorded replay time.
- Public facility context, representative asset render and synthetic metrics are visually distinguished.
- Licensed/bundled model assets and necessary attribution are documented; required demo assets do not fetch from untrusted external hosts during live presentation.

### UX-05 — Performance and resilience (P0)

- Seeded simulation runtime target: **≤ 5 seconds** on documented deployment, measured excluding AI and rendering.
- All P0 journeys pass with **Gemini disabled**.
- Scenario and invariant test suite includes breaker connectivity, inverter power limits, battery energy bounds and deterministic reruns.
- Basic input validation prevents unsafe unsupported references/parameters; no real equipment-control pathway exists.

## 6. Release acceptance matrix

| Release check | Related flows | Required evidence | Priority |
|---|---|---|---|
| Landing map and non-affiliation disclosure | UF-01 | Browser/keyboard navigation test; content audit | P0 |
| Fridley-only full lab behavior | UF-01, UF-02 | End-to-end route test | P0 |
| Five equipment classes + consistent selection | UF-02 | UI and state consistency tests | P0 |
| Valid configuration save/versioning | UF-03 | Form and immutable-version tests | P0 |
| Six real executable scenarios | UF-04, UF-05 | Six deterministic fixture tests | P0 |
| Power, connectivity and energy constraints | UF-05 | Unit and property/invariant tests | P0 |
| Assertion evidence and explanation | UF-06 | Schema/content tests | P0 |
| Manual authoring with Gemini disabled | UF-04, UF-09 | AI-off E2E smoke test | P0 |
| End-to-end fault demonstration | UF-00 | Browser acceptance test | P0 |
| 2.5D polish, 3D/static inspector | UF-02 | Asset selection and WebGL-off tests | P1 |
| Synchronized replay and electrical schematic | UF-06 | Timestamp synchronization test | P1 |
| Baseline/modified-run comparison | UF-07 | Comparison accuracy test | P1 |
| Evidence packet export | UF-08 | Download and content validation | P1 |
| Map failure fallback | UF-01, UF-10 | Offline/map-blocked test | P1 |
| Gemini draft tests | UF-09 | Mocked model responses, error-path checks | P2 |

### Ship/no-ship rule

- **Ship:** All P0 checks pass; measured performance and limitations are documented; user-visible P1 features pass if included; no deceptive live/official Cummins claims.
- **Do not ship:** Any P0 invariant fails, a test result is fabricated, AI is required for core operation, a broken CTA masquerades as implemented functionality, or a demo cannot complete the map-to-test journey.
- **Defer:** Optional Gemini and advanced model polish if they threaten P0 completion.

## 7. Requirements traceability index

This mapping links the new flow IDs to the existing PRD identifiers without renumbering PRD requirements.

| Flow | PRD requirements | PRD acceptance references |
|---|---|---|
| UF-00 Showcase | FR-01–02, FR-07–20, FR-26–27 | AC-01, AC-04, AC-08–11, AC-15–16, AC-18 |
| UF-01 Map | FR-01–04, FR-26–28 | AC-01–02, AC-15–16, AC-18 |
| UF-02 Assets | FR-05–06, FR-27, FR-29 | AC-03, AC-17–18 |
| UF-03 Configuration | FR-07–09, FR-18 | AC-03–04, AC-11 |
| UF-04 Test authoring | FR-10, FR-15, FR-22, FR-30 | AC-09, AC-13, AC-19 |
| UF-05 Simulation | FR-11–16 | AC-04–09 |
| UF-06 Evidence/replay | FR-14–19 | AC-08–10 |
| UF-07 Comparison | FR-20 | AC-11 |
| UF-08 Export | FR-21, FR-26–27 | AC-12, AC-18 |
| UF-09 AI drafts | FR-22–25, FR-30 | AC-13–14, AC-19 |
| UF-10 Recovery | FR-09, FR-18, FR-24, FR-29–30 | AC-10, AC-13, AC-17, AC-19 |

## 8. Approved decisions and remaining architecture assumptions

The following **three Step 2 decisions are approved** and must guide the database design, routes and API contracts:

| Topic | Locked MVP decision | Behavioral consequence |
|---|---|---|
| Persistence | **Server-side persistence** | Saved configuration versions, scenarios and completed immutable run evidence survive page refresh and can be fetched again within the authorized demo workspace. No account system is required for the MVP. |
| Report format | **PDF required** | A completed run supports a valid downloadable PDF evidence packet. HTML-only export does not satisfy acceptance criteria. |
| Primary showcase | **Generator G1 startup-delay regression** | With a seeded 10-second G1-readiness assertion, a simulated 5-second start passes and a 15-second start fails, as calculated by the engine. Critical-load continuity is checked separately. |

**Remaining architecture details (engineering decisions, not requests to reopen product scope):**

| Topic | Proposed implementation direction | Required safeguard |
|---|---|---|
| Demo access | Public demo with anonymous server-side workspace identifier | Avoid cross-visitor data exposure and unbounded storage; agree on retention policy during architecture design |
| Persistence failures | Server confirms writes and returns stable record/version IDs | No false success state; recover gracefully on network/server errors |
| Map connectivity | Online MapLibre tiles with bundled facility-list fallback | Users can still access Fridley if tiles fail |
| 3D assets | Licensed GLB/glTF for selected hero equipment, with static fallback images | Do not misrepresent synthetic equipment as facility-installed units |
| Scenario editing | Structured validated form, not an arbitrary topology editor | Simulation must actually use each configurable parameter |
| Replay | Discrete recorded events, with only justified interpolation | Never fabricate intermediate equipment states |
| Comparison | Prefer same-scenario, same-requirement comparisons | Clearly flag noncomparable runs |
| AI usage | One explicitly triggered Gemini drafting request; manual fallback | No API calls needed for simulations, results, or PDFs |
| Facility data | Verify public facility locations and context before release | Clearly separate real facility context from synthetic lab operations |

**Release note:** Server persistence and PDF output are explicitly in scope even if they increase implementation effort. The flagship demonstration must be backed by automated fixtures asserting the real computed readiness pass→fail transition.

## 9. QA walkthrough for final demo

1. Open a fresh browser; verify map-first landing, attribution and all three facility entries.
2. Select Seymour: confirm informational-only. Select Daventry: open the synthetic workbench, run 300 kW at 0.70 power factor and confirm package B passes real power but fails apparent power. Select Fridley: enter simulated lab.
3. Select G1 from the physical layout and accessible equipment list; verify matching ID, parameters and illustrated asset disclosure.
4. Validate/snapshot the baseline configuration; choose outage scenario; execute; record run ID, traces and checks.
5. Start with the seeded **G1 5 s** baseline and **10 s ready-by assertion**; save a revised **15 s** G1 startup-delay configuration and rerun. Verify computed readiness pass→fail while load continuity remains independently computed.
6. Inspect changed requirement result and event evidence; ensure the outcome is actually computed.
7. Scrub replay; verify all state views align, including breaker and battery states.
8. Compare persisted runs and export a valid **PDF** for the selected run; verify report disclosures and that its inputs match the saved snapshot.
9. Reload the page and reopen saved evidence from the server; then disable Gemini and WebGL and repeat the manual test path with static equipment fallback.
10. Inject malformed parameters, breaker connectivity constraints and limited battery power; verify no impossible power delivery, invalid SOC, or false pass status.

**Definition of done:** The app consistently answers **“What was configured? What happened? Which requirement passed or failed, and based on what evidence?”** within a clearly labeled **synthetic, independent** integration-test environment.

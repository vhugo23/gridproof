# GridProof — Product Requirements Document

**Document:** `docs/01-product-requirements.md`  
**Version:** 1.2 (product decisions locked; 1.2 aligns report format and facility count with doc 02 and the roadmap)  
**Date:** October 17, 2026  
**Status:** MVP product decisions approved; engineering specification  
**Product:** GridProof — Virtual Power Integration & Commissioning Workbench

> **Product positioning:** GridProof is an independent, Cummins-inspired educational/portfolio prototype. It is **not** an official Cummins product, connected to Cummins facilities, or qualified to approve, commission, or control real electrical installations. Cummins locations and product families provide public industry context; operational records, system configurations, and simulation results are synthetic.

## 1. Product overview

GridProof is a web-based engineering workbench for configuring a representative critical-power system, executing reproducible failure-response tests, and tracing test results to explicit customer acceptance requirements. Its primary demonstration environment is a virtual power integration lab inspired by Cummins' Power Integration Center (PIC) in Fridley, Minnesota.

The experience begins with a geographic directory of verified Cummins sites and enters the Fridley-inspired virtual lab. There, users inspect physical generator/battery/switchgear assets, adjust supported parameters, execute deterministic test scenarios, replay state transitions, and export an evidence-backed report. A small, optional AI feature converts natural-language test descriptions into **draft** structured scenarios for engineer review.

**Product hook:** Connect customer-specific power-system requirements to reproducible simulated integration tests and auditable pass/fail evidence **before field commissioning**.

**Primary value:** Test traceability and reviewable integration evidence, not invention of generator fault simulation or replacement of existing Cummins testing/control capabilities.

### Approved UX and feature decisions (October 17, 2026)

| Decision | Locked direction | Product consequence |
|---|---|---|
| Landing experience | **Geographic map first** | The home route is a facility map; select Fridley and choose **Enter Virtual Lab** to access the only complete simulation. Seymour has an informational site card only; Daventry's card also opens an independent synthetic generator workbench (D-24, D-27). |
| Physical visualization | **Hybrid** | Use a performant, navigable **2.5D site layout** with selectable equipment hotspots; selecting equipment opens a **3D asset inspector** where a properly licensed GLB/glTF asset is available, with a permitted static render fallback. Full free-roam 3D site navigation is not required. |
| Branding | **Independent GridProof identity** | GridProof wordmark, original UI styles, restrained industrial design; Cummins appears only in attributed public context. Clearly display an **Independent prototype — not affiliated with Cummins** notice on map, virtual lab and reports. No official Cummins header/logo treatment. |
| AI capability | **Draft tests from natural language** | An optional, user-triggered Gemini request generates a proposed structured scenario. Local schema/rule checks and explicit human confirmation precede simulation. Manual authoring and saved example templates always remain available. No AI chat, continuous inference or AI-generated engineering calculations in MVP. |

**Visual hierarchy:** The geographic map owns the first view. The Fridley workspace opens with a large 2.5D equipment canvas (roughly primary content area), a selected-asset inspector beside it, and compact scenario/timeline/results panels beneath. Physical scene, single-line diagram and results must be derived from the same immutable run state. The UI should resemble a professional engineering tool rather than a generic KPI dashboard.

**Asset policy:** Use documented, reusable 3D equipment models or images with preserved licensing and attribution. A representative model must be marked *illustrative*, not an accurate Cummins product or installed Fridley asset. Never require external model downloads during a live demo; bundle essential assets with the application.

## 2. Problem statement

Integrated critical-power systems coordinate generators, battery energy storage, electrical switching, utility supply, and critical loads. Engineers must establish that configurations satisfy site-specific requirements across normal operation and failures. A failure can be caused by an interaction among components—for example, a generator may be ready but unable to supply load because a breaker is open, or battery energy may be sufficient while inverter power is insufficient.

The proposed product addresses the **workflow challenge** of linking requirements, equipment configuration, execution history, and test outcomes in a single reviewable workbench. Cummins already operates sophisticated integration testing at its PIC; whether its internal test preparation, execution, or reporting workflow is underserved is **not verified**. GridProof demonstrates a plausible assistive software approach rather than claiming an identified gap inside Cummins.

## 3. Target users

| User | Goal | MVP priority |
|---|---|---|
| Power systems integration engineer | Configure a representative system, run integration tests, investigate failures | **Primary** |
| Commissioning engineer | Review test evidence against acceptance criteria | Secondary |
| Application/project engineer | Understand customer requirements, scenarios, and unresolved issues | Secondary |
| Recruiter / engineering interviewer | Explore a credible end-to-end technical demonstration | Demo stakeholder, not an operational persona |

No MVP features imply access to proprietary Cummins engineering data or actual customer projects.

## 4. User personas or use cases

**Persona A — Integration engineer.** Designs a 180 kW critical-load test with two simulated 250 kW generators and a 250 kW/500 kWh usable battery system. Changes a generator startup delay, reruns the outage test, and inspects the precise requirement assertion that changed from pass to fail.

**Persona B — Commissioning reviewer.** Opens a previous simulation, checks configuration version, input assumptions, time-ordered events, actual assertion values, and test outcome. Exports the same evidence in a report.

**Persona C — Application engineer.** Browses the Cummins-inspired facility map, learns about the real Fridley PIC, then opens the clearly labeled *virtual* test workspace to explain how a proposed power system handles failures.

**Persona D — AI-assisted test author.** Describes a utility outage with a generator start failure and a required restoration deadline. Reviews the AI-generated draft and edits any unsupported or missing fields before validation and execution. Falls back to manual authoring when AI is unavailable.

**Showcase use case:** Change G1's startup delay or inject a failed-start event; run the same utility-loss scenario; compare before/after restoration timing and requirement violations; replay the resulting event sequence; export the finding.

## 5. Core features

| ID | Feature | MVP behavior |
|---|---|---|
| CF-01 | Geographic facility map | Verified Cummins site markers with contextual details and clear prototype labels |
| CF-02 | Fridley virtual integration lab | Clickable 2.5D site layout with focused 3D equipment inspection and static-asset fallback |
| CF-03 | System configuration | Edit supported capacities, delays, load levels, fault parameters and save versioned snapshots |
| CF-04 | Single-line diagram | Display modeled electrical connectivity, breaker states, and active power sources |
| CF-05 | Discrete-event simulator | Deterministically model equipment transitions, outage/failure events, and simplified power delivery |
| CF-06 | Scenario catalog and authoring | Six seeded scenarios plus validated, manually editable test definitions |
| CF-07 | Requirements and assertions | Evaluate explicit restoration, service continuity, reserve, capacity, and sequencing checks |
| CF-08 | Replay and evidence | Synchronized physical scene, schematic, charts, and timestamped event timeline |
| CF-09 | Report export | Download scenario inputs, assumptions, assertions, events, and outcomes |
| CF-10 | Optional AI test drafting | User-triggered natural-language-to-structured **draft** test only; review and validation required; never execute automatically |

## 6. Functional requirements

Requirement IDs are stable references for engineering implementation and acceptance tests.

### Facility navigation and presentation

- **FR-01:** The application shall open on a geographic map (the default landing route) containing **exactly three verified Cummins facilities in V1**: Fridley (Minnesota), Seymour (Indiana), and Daventry (United Kingdom), with locations checked against published sources before release.
- **FR-02:** Selecting the Fridley marker shall reveal a facility detail panel with a clearly labeled **Enter Virtual Lab** action that opens the fully interactive **virtual PIC** workspace.
- **FR-03:** Selecting Seymour or Daventry shall display verified facility context and illustrative equipment information, **not** a simulated live facility or a separate fully functional domain. *Amended 2026-10-19 (D-24):* Daventry may additionally offer a clearly labeled, independent, synthetic generator-package screening exercise (deterministic, backend-validated, with stated assumptions and limits). It is not a live facility, factory operation, product selection or recommendation, and makes no claim to official Cummins data. Implemented as the Daventry workbench (task H-10, API-17, D-27); the real site's catalog description stays factual and unchanged. See PROJECT-STATUS for verification and deployment status.
- **FR-04:** The application shall visibly identify all map, asset and simulation data as public-context, representative, or synthetic as appropriate.
- **FR-05:** The Fridley workbench shall present a clickable **2.5D physical site layout** showing **at least five equipment classes** (generators, battery storage, switchgear, utility connection, and load/load bank). Selecting a component shall open a focused **3D GLB/glTF inspector** where a licensed model is available, with a licensed static-image fallback. A complete free-roam 3D campus is not required; no asset may imply verified installation at the real PIC.
- **FR-06:** Selecting a 2.5D hotspot or equipment card shall highlight the same asset across the site, inspector, and diagram, and display its ID, representative model type, configured capacity, current **simulated** state, and relevant parameters.

### Configuration and execution

- **FR-07:** The system shall load a seeded Fridley-inspired scenario with G1 and G2 (250 kW each), a battery (250 kW inverter, 500 kWh usable capacity), an external grid source, breakers/transfer logic, a 180 kW critical load, and adjustable simulated load-bank demand.
- **FR-08:** The engineer shall be able to change supported settings (e.g., generator startup time, fault injection, load, battery initial SOC, and assertion thresholds) and save a versioned configuration snapshot.
- **FR-09:** Invalid configurations, including negative capacities, out-of-range SOC, or unknown equipment references, shall be rejected with understandable validation messages.
- **FR-10:** The system shall execute the following six seeded scenarios: normal operation; utility outage; generator start failure; breaker fails to close; battery depletion; and load exceeds available support.
- **FR-11:** The simulation shall use deterministic state machines and a time-ordered event queue so identical configuration, scenario and seed/inputs produce identical results.
- **FR-12:** The simulator shall model generator startup/failure/trip states; utility availability; breaker connectivity; simplified power allocation; battery inverter power and usable energy/SOC limits; and served vs unserved critical load.
- **FR-13:** A generator shall not be considered able to serve the load solely because it is running; a valid closed electrical path must exist. Battery power delivery shall be limited by inverter power rating and remaining usable energy.
- **FR-14:** The simulator shall calculate at minimum: critical load demand, connected available generation, delivered power, unserved load, battery SOC, and restoration elapsed time, when applicable.
- **FR-15:** The system shall evaluate explicit scenario acceptance assertions, including restoration deadline, critical load served, minimum SOC, permissible transfer sequence, and capacity constraints.
- **FR-16:** The system shall preserve actual result and expected fixture outcome separately; an expected pass/fail classification must never substitute for computed results.

### Results, replay, and AI

- **FR-17:** The application shall present a timestamped event log including equipment state changes, fault injections, transfer attempts, and assertion evaluations.
- **FR-18:** The physical equipment view, single-line diagram, charts, and playback timeline shall derive from the **same recorded simulation state** at each replay time.
- **FR-19:** Users shall be able to replay and pause a completed run and inspect the inputs and evidence associated with a failed assertion.
- **FR-20:** The application shall compare at least two runs or configuration snapshots and identify changes in key results and pass/fail statuses.
- **FR-21:** The system shall export a downloadable **PDF** report generated from a saved run snapshot, containing project and configuration identifiers, assumptions, scenario and requirement definitions, event trace, measured outcomes, and limitations.
- **FR-22:** Users shall be able to create/edit supported test scenarios manually with **no AI access**.
- **FR-23:** On explicit user request only, the optional Gemini integration shall attempt to produce a **draft** scenario matching the supported schema. The application shall independently validate the schema, allowed event types, asset references and assertion values, show the resulting draft to the user for editing/confirmation, and never execute automatically or control electrical assets.
- **FR-24:** If AI access is unavailable or usage limits are reached, the core configuration, execution, result review, and report workflow shall remain usable; saved approved scenario templates may be reused without another API request.
- **FR-25:** The system shall clearly distinguish AI-suggested content from validated simulation output and require user confirmation before running an AI-authored draft. It shall expose request/quota failure and manual fallback without blocking the workflow.

### Brand and interaction requirements

- **FR-26:** The app shall use independent GridProof branding and a persistent or readily discoverable non-affiliation notice; public Cummins location names are contextual references, not claims of endorsement.
- **FR-27:** Site cards shall explicitly distinguish a **verified physical location**, an **illustrative virtual model**, and **synthetic operational values**; no UI label shall imply actual live telemetry or commissioning certification.
- **FR-28:** On the landing map, clicking a marker shall select that facility, focus its detail card and expose its available action without automatically launching unrelated simulations.
- **FR-29:** In the asset inspector, mouse/touch selection and keyboard-accessible alternatives shall access the same asset detail; missing WebGL or a missing 3D model shall fall back to an image and full textual details.
- **FR-30:** Each bundled exemplar AI test template shall be editable and runnable with Gemini disabled. An API failure shall never consume the user's manually entered scenario fields.

## 7. Nonfunctional requirements

| ID | Requirement | MVP target / verification |
|---|---|---|
| NFR-01 | Determinism | Identical run inputs reproduce identical event traces and assertion results in automated tests |
| NFR-02 | Correctness | Zero known violations of defined power, energy, connectivity and state-machine invariants across seeded tests |
| NFR-03 | Performance | Seeded scenarios complete in **≤ 5 seconds** at the tested deployment tier, excluding optional AI calls and rendering; benchmark and publish measured values |
| NFR-04 | Responsiveness | Layout supports desktop screens at 1280 px width and up; provide usable smaller-screen navigation without promising full mobile 3D authoring |
| NFR-05 | Availability without AI | 100% of core demo flows work with Gemini disabled or rate-limited |
| NFR-06 | Traceability | Every assertion result references its requirement ID, run ID, configuration version, and evidence values |
| NFR-07 | Observability | Errors and simulation failures produce actionable logs without leaking secrets |
| NFR-08 | Security | No production credentials in client code; server-side AI keys; input validation, request limits and basic access boundaries |
| NFR-09 | Maintainability | Typed APIs/schema contracts, modular simulation logic, automated CI tests, and documented environment setup |
| NFR-10 | Accessibility | Keyboard-operable essential controls, labeled components, non-color-only status indicators, and readable contrast |
| NFR-11 | Asset provenance | Licensed/reusable renders or GLB/glTF models with attribution where required; independent GridProof identity and no implication of Cummins endorsement |
| NFR-12 | Transparent limitations | Reports and the UI disclose that outputs are simplified simulations, not engineering certification or field commissioning approval |

| NFR-13 | Hybrid rendering robustness | 2.5D site remains usable without WebGL; inspector falls back to static render and textual specifications if model loading fails |
| NFR-14 | Offline demo resilience | Core map, bundled assets, seeded simulation, manual scenario editor, playback and results do not need Gemini or external asset downloads during the demo |

Targets are release goals; actual performance and coverage must be measured and reported honestly.

## 8. User stories

- **US-01:** As a visitor, I want to click a verified Cummins facility on a map so I can understand the engineering context of the prototype.
- **US-02:** As an integration engineer, I want to inspect generator, battery, switchgear, grid, and load assets so I can understand the configured system.
- **US-03:** As an integration engineer, I want to change startup timing or inject a failure so I can assess the effect on system response.
- **US-04:** As an integration engineer, I want to run repeatable outage and equipment-failure tests so I can investigate behavior under defined conditions.
- **US-05:** As a reviewer, I want to see a synchronized electrical schematic and physical scene so I can verify the displayed state is consistent.
- **US-06:** As a reviewer, I want each failed assertion linked to input settings and event timestamps so I can explain why the test failed.
- **US-07:** As an engineer, I want to compare before/after runs so I can understand the effect of a configuration change.
- **US-08:** As a commissioning reviewer, I want to export an evidence packet so I can review the configuration, results, and open issues.
- **US-09:** As an engineer, I want to create tests manually so API cost or service unavailability never blocks my workflow.
- **US-10:** As an engineer, I want AI to draft a test from a short requirement, subject to my review, so I can reduce repetitive authoring work when AI is available.
- **US-11:** As a visitor, I want the map to be the first screen and show which facility offers a virtual lab, so I can understand the intended navigation.
- **US-12:** As an engineer, I want to click an asset in a 2.5D layout and examine its model or static render without losing its simulated state, so I can understand how physical components relate to the tested system.

## 9. Acceptance criteria

The MVP is accepted only when each criterion is demonstrably satisfied. Scenario expected outcomes below are **test-fixture targets**, not asserted simulation achievements.

| ID | Given / When / Then | Evidence |
|---|---|---|
| AC-01 | **Given** the map, **when** a user selects Fridley, **then** the virtual PIC lab opens with its simulation dataset and independent-prototype notice | End-to-end UI test |
| AC-02 | **Given** Seymour or Daventry, **when** selected, **then** contextual facility content appears without fabricated telemetry or editable plant-control functions (amended 2026-10-19, D-24 and D-27: Daventry's card also offers a labeled synthetic generator workbench; it must not present live status, plant control or official product selection) | UI test and content audit |
| AC-03 | **Given** an asset is selected, **when** its details are opened, **then** its displayed ID, capacity, and state agree with the active configuration/simulation | Component integration test |
| AC-04 | **Given** the baseline seeded fixture, **when** it is executed twice, **then** the complete time-ordered traces and assertions match | Determinism test |
| AC-05 | **Given** a disconnected generator breaker, **when** generator output is available, **then** the generator contributes no served power through that open path | Invariant unit test |
| AC-06 | **Given** a load greater than battery inverter power while other supply is unavailable, **when** simulated, **then** served power is capped and unserved power is reported | Power-limit fixture |
| AC-07 | **Given** a prolonged battery discharge scenario, **when** usable energy is exhausted, **then** SOC does not fall below its valid modeled bound and unserved load is recorded as applicable | Energy-balance fixture |
| AC-08 | **Given** a generator-start or breaker-close failure, **when** the relevant restoration requirement is violated, **then** an assertion fails with observed value, threshold, and event references | Failure fixture |
| AC-09 | **Given** each of the six catalog scenarios, **when** executed, **then** the engine returns a computed result, trace, and requirement evaluation (or clearly explained invalid-input error) | Six scenario tests |
| AC-10 | **Given** a completed run, **when** paused or scrubbed to a timestamp, **then** the scene, diagram, chart, and log show the same recorded equipment state | Replay UI test |
| AC-11 | **Given** two runs with different G1 startup delays, **when** compared, **then** changes in restoration timing and assertion status, if any, are correctly displayed | Run-comparison test |
| AC-12 | **Given** a completed run, **when** the report is exported, **then** it includes requirements, configuration, event data, results and the simulation limitation notice | Export test |
| AC-13 | **Given** Gemini is disabled, **when** a user manually defines and runs a scenario, **then** the complete core workflow remains successful | Offline-AI end-to-end test |
| AC-14 | **Given** AI returns an invalid/unsupported test draft, **when** validation executes, **then** the draft is rejected or flagged and cannot run until corrected and confirmed | Schema/authorization test |
| AC-15 | **Given** the released demo, **when** a visitor navigates from the map to the Fridley lab and executes the showcase fault, **then** the complete workflow runs without private credentials or real facility access | Release smoke test |

| AC-16 | **Given** a fresh visit, **when** the app loads, **then** the geographic facility map is the landing screen; selecting Fridley exposes **Enter Virtual Lab** and enters the Fridley workspace | Navigation e2e test |
| AC-17 | **Given** a 2.5D site view, **when** a generator hotspot is selected, **then** its matching asset panel, simulated values, and optional 3D inspector are shown; disabling WebGL preserves the image/text fallback | UI/WebGL fallback test |
| AC-18 | **Given** any product screen or exported report, **when** attribution is inspected, **then** GridProof is clearly identified as independent and simulated data is not presented as live Cummins operations | Branding and content audit |
| AC-19 | **Given** a Gemini-generated draft, **when** the user reviews and edits it, **then** only a valid explicitly confirmed draft may execute, and the manual path is still available on rate-limit or API error | AI integration test |

## 10. MVP scope

### Included

1. **One fully functional virtual lab:** Fridley-inspired PIC, clearly labeled simulated.
2. **Three contextual map locations:** Fridley, Seymour, Daventry (verified public context; no simulated operations at Seymour or Daventry; Daventry additionally offers the labeled synthetic workbench).
3. **One seeded system:** Two 250 kW generators; 250 kW/500 kWh usable BESS; utility; breakers/switchgear; 180 kW critical load; adjustable load bank.
4. **Six test scenarios:** Normal, utility outage, generator start failure, breaker fails to close, battery depletion, excessive demand.
5. **At least five equipment classes** displayed on a clickable **2.5D lab layout**, with a **3D asset inspector** where licensed GLB/glTF assets exist and a static fallback; linked single-line diagram.
6. **Parameter editor, configuration snapshot, event-driven simulation, assertions, synchronized replay, before/after comparison, downloadable evidence report.**
7. **Optional single Gemini workflow:** Natural-language **draft test creation**, schema validation, explicit review/confirmation, manual fallback, and bundled approved example templates.
8. **Engineering proof:** automated invariants/scenario tests, deployment, README, known-limitation disclosures, and measured benchmark results.

### Delivery priorities

- **P0 — Must ship:** deterministic simulator, six scenarios, invariant tests, configuration, result trace and assertions, functional Fridley workspace, map-to-lab entry, manual authoring.
- **P1 — Strong MVP:** polished 2.5D site and 3D equipment inspector with image fallback, synchronized diagram and replay, two-run comparison, PDF report export (implementation priority P1, but required for the finished showcase), contextual site cards, independent visual identity.
- **P2 — Optional:** Gemini **draft-test** authoring and nonessential animation/3D refinement; manual draft authoring remains P0.

If the schedule becomes constrained, P0 correctness takes precedence over asset polish and AI.

## 11. Out-of-scope features

- Direct integration with Cummins systems, real facilities, field instrumentation, or customer datasets.
- Control or remote operation of live generators, breakers, batteries, or utility equipment.
- Electrical transient, electromagnetic, protection-coordination, harmonic, synchronization or full AC power-flow studies.
- Safety certification, regulatory compliance determination, production-grade commissioning approval, or warranty recommendations.
- Full recreation of proprietary Cummins PowerCommand controls, PIC testing tools, or internal workflows.
- Additional fully simulated Cummins locations, mining/trucking/manufacturing modules, or a global asset telemetry network. *Amended 2026-10-20 (D-28):* the Mining and off-highway application brief may open one clearly labeled, independent, synthetic duty-cycle energy calculator that works only on user-entered numbers; it is not a simulated facility or module and implies no real operations, fuel, range or propulsion modeling.
- Unrestricted AI agents, autonomous control changes, frequent paid model calls, or AI-dependent simulation decisions.
- Complex role-based enterprise authorization, real ERP/CMMS integrations, or multi-tenant customer provisioning.
- Photorealistic custom-engineered 3D models requiring proprietary CAD data; free-roam 3D campus rendering or CAD-level geometry.
- Official Cummins-branded app shell, corporate identity impersonation, or claims that the prototype is commissioned/authorized by Cummins.
- Chatbot-first AI operations, autonomously generated control actions, recurring Gemini polling, or AI-generated numerical simulation outcomes.

## 12. Success metrics

Metrics below are **targets and evaluation methods**, not achieved claims.

| Metric | MVP target | Measurement |
|---|---|---|
| Core scenario execution | 6/6 seeded scenarios execute and return trace plus assertion results | Automated scenario suite |
| State/energy/connectivity invariants | 0 violations in released seeded and edge-case tests | Unit/property-based tests |
| Deterministic replay | 100% matching traces for identical seeds/configurations in the evaluation suite | Repeated execution hashes/comparisons |
| Core AI independence | 100% of P0 flows succeed with AI disabled | AI-off smoke test |
| Result traceability | 100% of reported assertion results include requirement/run/config identifiers and evidence values | Report schema validation |
| Simulator latency | ≤ 5 seconds per seeded run on tested deployment | Timed benchmark, hardware/tier documented |
| Integration demo | Complete **landing map** → Fridley → configure → run → replay → export path succeeds | Playwright end-to-end test |
| Physical visualization usability | All five asset classes can be selected and inspected, including when WebGL is unavailable | UI and fallback test |
| Brand/data clarity | No unaudited official endorsement, fabricated live telemetry, or unlabeled synthetic operational metrics | Content review |
| Fault detection | All deliberately injected, defined fixture violations produce the corresponding failed assertion | Ground-truth fixture suite |
| Test authoring usability | Manual authoring possible for all six scenario types | UI acceptance tests |
| Optional AI quality | For a small fixed evaluation set, report valid-schema rate, correct scenario mapping, unsupported-request handling, and total Gemini calls | Controlled evaluation; no fabricated percentages |
| Workflow-efficiency hypothesis | Compare time to assemble a traceable test/report manually vs. using GridProof in a controlled task | Measured before/after, with sample size and limitations disclosed |

## 13. Assumptions and limitations

### Assumptions

- The user is performing **simulation and engineering review**, not actual commissioning authorization.
- A discrete-event state-machine model is sufficient to demonstrate **high-level operational sequencing and capacity-related assertions**, although it cannot establish physical electrical safety or power quality.
- The example capacities and customer restoration requirements are synthetic, chosen to illustrate interactions rather than replicate PIC equipment or a Cummins customer system.
- Publicly documented Cummins sites and product context may be used with appropriate attribution; independent project branding and asset licensing requirements remain in force.
- An optional Gemini free-tier integration may be unavailable, rate-limited, or subject to changing quotas; it cannot be a dependency for core functionality.
- Only Fridley needs a functioning simulation; other site markers provide verified context.
- The site view uses representative 2.5D imagery, not a measured digital twin of the actual Fridley facility; 3D assets are inspection aids with licensed static fallbacks.
- Independent GridProof branding has been chosen instead of replicating Cummins’ logo/official application shell.

### Technical limitations

- Simplified power balance does not reproduce voltage/frequency dynamics, inrush, short circuits, switching transients, protection coordination, grid-forming behavior, or synchronization.
- Generator start delays, faults, transitions, and battery discharge are parametrized abstractions; modeled timings do not represent measured Cummins equipment performance.
- Simplified connectivity and energy models cannot certify redundancy, transfer reliability, or uninterrupted power to real equipment.
- A *passed* test means only that **the defined assertions pass in the specified synthetic model**.
- A visual asset does not establish that exact depicted equipment is available or installed at a real site.
- The facility map is a **navigation and contextual reference layer**, not a source of live telemetry or Cummins organizational system topology.
- AI-produced drafts can be incorrect or incomplete; schema/rule validation and user confirmation are mandatory.

### Business and validation limitations

- The PIC and related Cummins control platforms already provide sophisticated real-world integration-testing capabilities. GridProof does not assert these capabilities are absent.
- The proposed unmet need—making test preparation, evidence traceability, or handoff more efficient—is a **hypothesis**, not a verified Cummins internal problem.
- Demonstrated simulator/test workflow performance must not be described as actual reductions in Cummins commissioning expense, downtime, failure probability, or labor hours.
- The prototype should invite engineering critique by exposing assumptions, fixture data, reproducible runs, and a clear separation between observed simulated outcomes and real-world claims.

---

**MVP sign-off rule:** Do not declare GridProof ready for demonstration until AC-01 through AC-19 have been evaluated, any deviations are recorded, and the end-to-end showcase executes with Gemini disabled.

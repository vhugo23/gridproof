// Educational text for the Seymour Engine Test-Plan Workbench. It describes what each
// result is for and what it cannot tell you; every number shown next to it comes from
// the backend response. General planning context, not GridProof results.

export type Explanation = {
  id: string;
  title: string;
  purpose: string;
  limits: string;
};

export const EXPLANATIONS: Explanation[] = [
  {
    id: "power",
    title: "Theoretical shaft power",
    purpose:
      "Power in kW from the speed and torque you entered: 2 × π × speed (rpm) × torque (N·m) ÷ 60,000. It lets a requirement ask for a minimum power as well as a speed and torque range.",
    limits:
      "It is arithmetic on your planned numbers, not measured, corrected or attainable power. It says nothing about efficiency, fuel or emissions, and it does not show that an engine can run at that speed and torque.",
  },
  {
    id: "regions",
    title: "Requirement regions",
    purpose:
      "A requirement is a rectangle in the speed-torque plane (a speed range and a torque range, bounds included), with an optional minimum theoretical power, a minimum number of planned entries and a minimum planned hold time.",
    limits:
      "Rectangles are a planning simplification. No tolerance, measurement uncertainty or engine limit is modeled, and a point planned exactly on a bound counts as inside it.",
  },
  {
    id: "coverage",
    title: "Covered by plan, partly covered, not covered",
    purpose:
      "Covered by plan means enough planned entries fall inside the region for enough planned hold time. Partly covered means some do but a count or hold is short. Not covered means no planned entry falls inside every bound.",
    limits:
      "This is planning coverage, not acceptance. A covered requirement does not mean the engine can operate at those points or that a test would succeed, and a not-covered one is a gap in the plan, not a fault in any engine.",
  },
  {
    id: "repeats",
    title: "Repeated operating points",
    purpose:
      "Repeating the same speed and torque is allowed because repeated holds can be intentional. Each repeat counts as a separate planned entry toward a requirement's minimum.",
    limits:
      "Repeats are never merged. They do not add distinct-condition coverage, so the result also reports how many distinct conditions the matching entries represent.",
  },
  {
    id: "hold",
    title: "Planned hold time",
    purpose:
      "The sum of the holds you scheduled, shown per point on a timeline in your order. The order changes the timeline and the step changes between points, not the coverage.",
    limits:
      "It is scheduled hold time, not total elapsed test time. Transitions, setup and stabilization are not modeled, a hold is not measured stable operation, and the step changes are plain differences, not ramp rates.",
  },
  {
    id: "evidence",
    title: "Evidence checklist",
    purpose:
      "A generic list of what would still be needed before anyone could say anything about real engine performance: limits from the engine's owner, an approved procedure and acceptance criteria, calibrated measurements and records.",
    limits:
      "It cites no standard or company procedure, GridProof tracks none of it, and every item stays Not started here. Collecting the evidence happens outside GridProof.",
  },
  {
    id: "diagram",
    title: "Speed-torque planning diagram",
    purpose:
      "Shows your requirement rectangles and your planned points, numbered in order, on a speed-torque grid, so gaps and clusters are easy to see.",
    limits:
      "It is not an engine map. It draws no performance curve, limit or operating envelope, and the empty space on it does not mean an engine can or cannot run there.",
  },
];

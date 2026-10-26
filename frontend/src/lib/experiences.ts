// Facilities that offer a synthetic exercise instead of (or beside) a lab. The
// catalog stays the source of facts about the real site; this registry only says
// what GridProof itself offers there. `is_interactive` still means "has the
// Fridley virtual lab" and is not used for these.

export type FacilityExperience = {
  hash: string;
  /** Short status shown on the card and the map marker. */
  kicker: string;
  cta: string;
  /** Names the experience in the map marker's accessible label. */
  markerLabel: string;
  title: string;
  blurb: string;
  /** Optional card illustration; omitted when the card shows none. */
  image?: { src: string; alt: string; fit?: "cover" | "contain" };
};

export const DAVENTRY_HASH = "#daventry-workbench";
export const SEYMOUR_HASH = "#seymour-test-plan";
// Opened from the Mining application brief, not from a facility.
export const MINING_HASH = "#mining-duty-cycle";
// Opened from the On-highway and mobile power brief, not from a facility.
export const MOBILE_HASH = "#mobile-power-planner";

const EXPERIENCES: Record<string, FacilityExperience> = {
  daventry: {
    hash: DAVENTRY_HASH,
    kicker: "Synthetic workbench",
    cta: "Open Synthetic Workbench",
    markerLabel: "synthetic generator workbench",
    title: "Generator Configuration Workbench",
    blurb:
      "An independent GridProof exercise: screen a customer load against four invented generator packages. Not the plant's software, operations or data; the packages are not Cummins products.",
    image: {
      src: "/illustrations/daventry-package-lineup.svg",
      alt: "Illustration of four synthetic generator sets of increasing size.",
    },
  },
  seymour: {
    hash: SEYMOUR_HASH,
    kicker: "Synthetic workbench",
    cta: "Open Test-Plan Workbench",
    markerLabel: "synthetic engine test-plan workbench",
    title: "Engine Test-Plan Workbench",
    blurb:
      "An independent GridProof exercise: check whether a plan of speed and torque points covers test requirements you define. Planning coverage only, not verification. Not the site's software, procedures or data; all numbers are synthetic.",
    image: {
      src: "/illustrations/seymour-test-plan.svg",
      alt: "Diagram of rectangular requirement regions on a speed and torque grid with four numbered planned points joined in order.",
      fit: "contain",
    },
  },
};

export function experienceFor(facilityId: string): FacilityExperience | null {
  return EXPERIENCES[facilityId] ?? null;
}

// Facilities that offer a synthetic exercise instead of (or beside) a lab. The
// catalog stays the source of facts about the real site; this registry only says
// what GridProof itself offers there. `is_interactive` still means "has the
// Fridley virtual lab" and is not used for these.

export type FacilityExperience = {
  hash: string;
  /** Short status shown on the card and the map marker. */
  kicker: string;
  cta: string;
  title: string;
  blurb: string;
};

export const DAVENTRY_HASH = "#daventry-workbench";

const EXPERIENCES: Record<string, FacilityExperience> = {
  daventry: {
    hash: DAVENTRY_HASH,
    kicker: "Synthetic workbench",
    cta: "Open Synthetic Workbench",
    title: "Generator Configuration Workbench",
    blurb:
      "An independent GridProof exercise: screen a customer load against four invented generator packages. Not the plant's software, operations or data; the packages are not Cummins products.",
  },
};

export function experienceFor(facilityId: string): FacilityExperience | null {
  return EXPERIENCES[facilityId] ?? null;
}

import {
  DAVENTRY_HASH,
  MINING_HASH,
  MOBILE_HASH,
  SEYMOUR_HASH,
} from "@/lib/experiences";

// Links use the same hash routes as the facility cards and application briefs, so they
// work by keyboard, by middle-click and as shareable addresses.
const EXPERIENCES = [
  {
    id: "fridley",
    title: "Fridley virtual lab",
    kind: "Interactive lab · saves a demo workspace",
    blurb:
      "Configure a synthetic power system, run a utility-outage startup test and compare the evidence.",
    cta: "Open the virtual lab",
    href: "#fridley-lab",
  },
  {
    id: "seymour",
    title: "Engine test-plan workbench",
    kind: "Synthetic workbench · Seymour",
    blurb:
      "Check whether planned speed and torque points cover the test requirements you define. Planning coverage only.",
    cta: "Open the test-plan workbench",
    href: SEYMOUR_HASH,
  },
  {
    id: "daventry",
    title: "Generator capacity screening",
    kind: "Synthetic workbench · Daventry",
    blurb:
      "Screen a customer load against four invented generator packages for real and apparent power.",
    cta: "Open the capacity workbench",
    href: DAVENTRY_HASH,
  },
  {
    id: "mining",
    title: "Duty-cycle energy analyzer",
    kind: "Synthetic calculator · Mining brief",
    blurb:
      "Turn power and duration segments into energy per cycle and per shift.",
    cta: "Open the duty-cycle analyzer",
    href: MINING_HASH,
  },
  {
    id: "mobile",
    title: "Mobile-site power planner",
    kind: "Synthetic calculator · On-highway brief",
    blurb:
      "Total a temporary site's electrical demand and compare it with four invented packages.",
    cta: "Open the site power planner",
    href: MOBILE_HASH,
  },
] as const;

export default function Experiences() {
  return (
    <section aria-labelledby="experiences-title" className="mt-6">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2
          id="experiences-title"
          className="text-sm font-semibold tracking-[0.15em] text-gp-text uppercase"
        >
          Five hands-on experiences
        </h2>
        <p className="text-[11px] text-gp-faint">
          All numbers are synthetic and independent of Cummins Inc.
        </p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {EXPERIENCES.map((e) => (
          <li
            key={e.id}
            data-experience={e.id}
            className="flex flex-col rounded-xl border border-gp-line bg-gp-surface p-3"
          >
            <p className="text-[10px] font-semibold tracking-widest text-gp-steel uppercase">
              {e.kind}
            </p>
            <h3 className="mt-1 text-sm font-semibold text-gp-text">
              {e.title}
            </h3>
            <p className="mt-1 text-xs leading-snug text-gp-muted">{e.blurb}</p>
            <a
              href={e.href}
              className="mt-auto inline-flex min-h-11 items-center pt-2 text-xs font-semibold tracking-wider text-gp-red-text uppercase hover:underline"
            >
              {e.cta} →
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

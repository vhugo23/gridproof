"use client";

import Image from "next/image";
import { experienceFor } from "@/lib/experiences";
import { PREVIEW_CONFIG } from "@/lib/previewConfig";
import type { Facility } from "@/lib/types";
import LabScene from "../lab/LabScene";

const noop = () => {};

export default function FacilityCard({
  facility,
  onEnter,
  onOpenExperience,
}: {
  facility: Facility;
  onEnter: (facility: Facility) => void;
  onOpenExperience: (facility: Facility) => void;
}) {
  const interactive = facility.is_interactive;
  // A synthetic exercise GridProof offers beside the real site's public facts.
  const experience = interactive ? null : experienceFor(facility.id);
  return (
    <aside
      aria-label={`${facility.name} details`}
      className="flex flex-col rounded-xl border border-gp-line-strong bg-gp-surface p-4 shadow-xl lg:absolute lg:inset-0 lg:overflow-y-auto"
    >
      <p
        className={`text-[11px] font-semibold tracking-widest uppercase ${
          interactive || experience ? "text-gp-red" : "text-gp-steel"
        }`}
      >
        {interactive
          ? "Interactive virtual lab"
          : experience
            ? experience.kicker
            : "Informational site"}
      </p>
      <h2 className="mt-1 text-lg leading-tight font-semibold text-gp-text">
        {facility.name}
      </h2>
      <p className="text-xs text-gp-muted">
        {facility.city}, {facility.region ? `${facility.region}, ` : ""}
        {facility.country} · approximate city-level marker
      </p>

      {interactive && (
        <div className="mt-3 overflow-hidden rounded-lg border border-gp-line bg-gradient-to-b from-gp-bg to-gp-surface-2 [&_svg]:h-[104px] [&_svg]:w-full">
          <LabScene
            preview
            config={PREVIEW_CONFIG}
            selected={null}
            onSelect={noop}
          />
          <p className="px-2 pb-1.5 text-center text-[10px] tracking-wider text-gp-faint uppercase">
            Synthetic lab preview
          </p>
        </div>
      )}

      {experience && (
        <div className="mt-2.5 h-[66px] shrink-0 overflow-hidden rounded-lg border border-gp-line bg-gp-bg">
          <Image
            src="/illustrations/daventry-package-lineup.svg"
            alt="Illustration of four synthetic generator sets of increasing size."
            width={780}
            height={262}
            unoptimized
            className="h-full w-full object-cover object-[50%_58%]"
          />
        </div>
      )}

      {experience ? (
        <>
          <div className="mt-2.5 rounded-lg border border-gp-red/40 bg-gp-red/5 p-2.5">
            <p className="text-xs font-semibold text-gp-text">
              {experience.title}
            </p>
            <p className="mt-1 text-[11px] leading-snug text-gp-muted">
              {experience.blurb}
            </p>
            <button
              type="button"
              onClick={() => onOpenExperience(facility)}
              className="mt-2.5 w-full rounded-md bg-gp-red px-3 py-2.5 text-sm font-semibold text-white shadow-lg shadow-gp-red/20 transition hover:brightness-110"
            >
              {experience.cta} →
            </button>
          </div>
          <p className="mt-2.5 text-[10px] font-semibold tracking-widest text-gp-steel uppercase">
            About the real site
          </p>
          <p className="mt-1 text-[11px] leading-snug text-gp-muted">
            {facility.description}
          </p>
        </>
      ) : (
        <>
          <p className="mt-2.5 text-[11px] leading-snug text-gp-muted">
            {facility.description}
          </p>
          <div className="mt-auto pt-4">
            {interactive ? (
              <button
                type="button"
                onClick={() => onEnter(facility)}
                className="w-full rounded-md bg-gp-red px-3 py-2.5 text-sm font-semibold text-white shadow-lg shadow-gp-red/20 transition hover:brightness-110"
              >
                Enter Virtual Lab →
              </button>
            ) : (
              <p className="text-xs text-gp-faint">
                Lab not modeled in this demo.
              </p>
            )}
          </div>
        </>
      )}
    </aside>
  );
}

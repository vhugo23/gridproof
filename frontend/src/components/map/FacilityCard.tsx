"use client";

import { PREVIEW_CONFIG } from "@/lib/previewConfig";
import type { Facility } from "@/lib/types";
import LabScene from "../lab/LabScene";

const noop = () => {};

export default function FacilityCard({
  facility,
  onEnter,
}: {
  facility: Facility;
  onEnter: (facility: Facility) => void;
}) {
  const interactive = facility.is_interactive;
  return (
    <aside
      aria-label={`${facility.name} details`}
      className="flex flex-col rounded-xl border border-gp-line-strong bg-gp-surface p-4 shadow-xl lg:absolute lg:inset-0 lg:overflow-y-auto"
    >
      <p
        className={`text-[11px] font-semibold tracking-widest uppercase ${
          interactive ? "text-gp-red" : "text-gp-steel"
        }`}
      >
        {interactive ? "Interactive virtual lab" : "Informational site"}
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
          <p className="text-xs text-gp-faint">Lab not modeled in this demo.</p>
        )}
      </div>
    </aside>
  );
}

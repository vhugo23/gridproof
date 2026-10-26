"use client";

import type { Facility } from "@/lib/types";

// An always-large, keyboard-friendly alternative to the map markers, which are small on
// phones. Choosing a facility only shows its card, exactly like selecting its marker.
export default function FacilityPicker({
  facilities,
  activeId,
  onActive,
}: {
  facilities: Facility[];
  activeId: string;
  onActive: (id: string) => void;
}) {
  return (
    <fieldset className="mt-3 min-w-0">
      <legend className="mb-1.5 text-[11px] font-semibold tracking-widest text-gp-muted uppercase">
        Choose a facility
      </legend>
      <div className="flex flex-wrap gap-2">
        {facilities.map((facility) => (
          <label
            key={facility.id}
            className="flex min-h-11 cursor-pointer items-center rounded-md border border-gp-line-strong bg-gp-surface px-3 py-2 text-sm text-gp-muted transition hover:bg-gp-surface-2 has-[:checked]:border-gp-red has-[:checked]:bg-gp-red/10 has-[:checked]:text-gp-text has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-gp-red"
          >
            <input
              type="radio"
              name="facility"
              value={facility.id}
              checked={facility.id === activeId}
              onChange={() => onActive(facility.id)}
              className="sr-only"
            />
            {facility.city}
            {facility.country === "US" && facility.region
              ? `, ${facility.region}`
              : `, ${facility.country}`}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

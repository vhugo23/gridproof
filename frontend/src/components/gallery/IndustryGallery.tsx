"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import type { AssetId } from "../lab/assets";
import ApplicationDialog from "./ApplicationDialog";
import { APPLICATIONS } from "./applications";

export default function IndustryGallery({
  onOpenLab,
}: {
  onOpenLab: (asset: AssetId | null) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const application = APPLICATIONS.find((a) => a.id === openId) ?? null;

  const close = () => {
    setOpenId(null);
    opener.current?.focus();
  };

  return (
    <section aria-labelledby="industry-applications" className="mt-6">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2
          id="industry-applications"
          className="text-sm font-semibold tracking-[0.15em] text-gp-text uppercase"
        >
          Industry Applications
        </h2>
        <p className="text-[11px] text-gp-faint">
          Illustrative artwork created for GridProof. Not product imagery;
          depicts no specific Cummins equipment.
        </p>
      </div>
      <ul
        aria-label="Industry applications"
        className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 py-1 lg:mx-0 lg:grid lg:grid-cols-5 lg:overflow-visible lg:px-0"
      >
        {APPLICATIONS.map((app) => (
          <li key={app.id} className="w-[250px] shrink-0 snap-start lg:w-auto">
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={(event) => {
                opener.current = event.currentTarget;
                setOpenId(app.id);
              }}
              className="group block h-full w-full overflow-hidden rounded-xl border border-gp-line bg-gp-surface text-left transition hover:border-gp-red/60 hover:bg-gp-surface-2 focus-visible:border-gp-red motion-safe:hover:-translate-y-0.5"
            >
              <Image
                src={app.image}
                alt={app.alt}
                width={360}
                height={225}
                unoptimized
                className="h-auto w-full"
              />
              <span className="block px-3 pt-2.5 pb-3">
                <span className="block text-sm leading-tight font-semibold text-gp-text">
                  {app.title}
                </span>
                <span className="mt-1 block text-[11px] leading-snug text-gp-muted">
                  {app.caption}
                </span>
                <span className="mt-2 block text-[11px] font-semibold tracking-wider text-gp-red uppercase transition group-hover:translate-x-0.5">
                  View brief →
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <ApplicationDialog
        application={application}
        onClose={close}
        onOpenLab={(asset) => {
          setOpenId(null);
          onOpenLab(asset);
        }}
      />
    </section>
  );
}

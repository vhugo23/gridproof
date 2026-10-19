"use client";

import Image from "next/image";
import { useEffect, useId, useRef } from "react";
import type { Application } from "./applications";
import type { ChallengeId } from "../challenges/deriveChallenge";
import type { AssetId } from "../lab/assets";

type Props = {
  application: Application | null;
  onClose: () => void;
  onOpenLab: (asset: AssetId | null, challenge?: ChallengeId) => void;
};

export default function ApplicationDialog({
  application,
  onClose,
  onOpenLab,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const summaryId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (application && !dialog.open) dialog.showModal();
    if (!application && dialog.open) dialog.close();
  }, [application]);

  useEffect(() => {
    if (!application) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [application]);

  const action = application?.action;

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={summaryId}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) ref.current?.close();
      }}
      className="m-auto w-[min(960px,calc(100vw-2rem))] max-w-none overflow-hidden rounded-2xl border border-gp-line-strong bg-gp-surface p-0 text-gp-text shadow-2xl backdrop:bg-black/75 max-sm:m-0 max-sm:mt-auto max-sm:w-full max-sm:rounded-b-none"
    >
      {application && (
        <div className="relative grid max-h-[90vh] overflow-y-auto md:grid-cols-[1.1fr_1fr] max-sm:max-h-[94vh]">
          <button
            type="button"
            onClick={() => ref.current?.close()}
            aria-label="Close application brief"
            className="absolute top-3 right-3 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-gp-line-strong bg-gp-bg/80 text-lg leading-none text-gp-muted hover:text-gp-text"
          >
            ×
          </button>
          <div className="flex items-center bg-gp-bg">
            <Image
              src={application.image}
              alt={application.alt}
              width={360}
              height={225}
              unoptimized
              className="h-auto w-full"
            />
          </div>
          <div className="flex flex-col p-5 md:p-6">
            <p className="text-[11px] font-semibold tracking-widest text-gp-red uppercase">
              Application brief
            </p>
            <h2
              id={titleId}
              className="mt-1 pr-10 text-xl leading-tight font-semibold"
            >
              {application.title}
            </h2>
            <p
              id={summaryId}
              className="mt-3 text-sm leading-relaxed text-gp-muted"
            >
              {application.summary}
            </p>
            <h3 className="mt-4 text-xs font-semibold tracking-wider text-gp-text uppercase">
              Engineering considerations
            </h3>
            <ul className="mt-2 space-y-2 text-sm leading-snug text-gp-muted">
              {application.considerations.map((item) => (
                <li key={item} className="flex gap-2">
                  <span aria-hidden className="text-gp-red">
                    ▸
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <div className="mt-5 border-t border-gp-line pt-4">
              {action ? (
                <>
                  <button
                    type="button"
                    onClick={() => onOpenLab(action.asset, action.challenge)}
                    className="w-full rounded-md bg-gp-red px-3 py-2.5 text-sm font-semibold text-white shadow-lg shadow-gp-red/20 transition hover:brightness-110"
                  >
                    {action.label} →
                  </button>
                  <p className="mt-2 text-[11px] leading-snug text-gp-faint">
                    {action.note}
                  </p>
                </>
              ) : (
                <p className="text-[11px] leading-snug text-gp-faint">
                  Informational brief only. GridProof does not simulate this
                  application.
                </p>
              )}
              <p className="mt-2 text-[11px] leading-snug text-gp-faint">
                Illustrative artwork created for GridProof; it does not depict
                specific Cummins equipment. Considerations are general
                engineering context, not GridProof results.
              </p>
            </div>
          </div>
        </div>
      )}
    </dialog>
  );
}

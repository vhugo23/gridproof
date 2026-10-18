import Image from "next/image";

export type IllustrationKind = "generator" | "battery" | "switchgear";

const ILLUSTRATIONS: Record<IllustrationKind, { src: string; alt: string }> = {
  generator: {
    src: "/illustrations/generator-set.svg",
    alt: "Illustration of an enclosed generator set",
  },
  battery: {
    src: "/illustrations/battery.svg",
    alt: "Illustration of a containerized battery storage enclosure",
  },
  switchgear: {
    src: "/illustrations/switchgear.svg",
    alt: "Illustration of a switchgear lineup",
  },
};

export default function EquipmentIllustration({
  kind,
}: {
  kind: IllustrationKind;
}) {
  const { src, alt } = ILLUSTRATIONS[kind];
  return (
    <figure className="mb-2 flex items-center gap-3 rounded-lg border border-gp-line bg-gp-bg p-1.5">
      <Image
        src={src}
        alt={alt}
        width={360}
        height={225}
        unoptimized
        className="h-auto w-28 shrink-0 rounded-md"
      />
      <figcaption className="text-[11px] leading-snug text-gp-faint">
        Illustrative image of this equipment type. It is not the simulated unit.
      </figcaption>
    </figure>
  );
}

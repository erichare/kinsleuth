import Image from "next/image";

import type { DemoArchiveMedia } from "@/lib/demo-archive-media";

type EvidenceScanProps = {
  media: DemoArchiveMedia;
  compact?: boolean;
  className?: string;
};

export function EvidenceScan({ media, compact = false, className }: EvidenceScanProps) {
  const classes = ["evidence-scan", compact ? "evidence-scan--compact" : undefined, className]
    .filter(Boolean)
    .join(" ");

  return (
    <figure className={classes}>
      <a
        aria-label={`Open the full synthetic scan for ${media.title} in a new tab`}
        className="evidence-scan-link"
        href={media.src}
        rel="noreferrer"
        target="_blank"
      >
        <Image
          alt={media.alt}
          className="evidence-scan-image"
          height={media.height}
          sizes="(max-width: 520px) 112px, 160px"
          src={media.src}
          width={media.width}
        />
        <span className="evidence-scan-action">
          Open full scan <span aria-hidden="true">↗</span>
        </span>
      </a>
      <figcaption className="evidence-scan-caption">
        <span className="evidence-scan-catalog">{media.catalogId}</span>
        {media.title}
      </figcaption>
    </figure>
  );
}

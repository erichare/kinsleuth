import Image from "next/image";
import { useId } from "react";

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

export function EvidenceRecordDetails({
  media,
  compact = false
}: {
  media: DemoArchiveMedia;
  compact?: boolean;
}) {
  const instanceId = useId().replaceAll(":", "");
  const transcriptHeadingId = `evidence-transcript-${media.recordId}-${instanceId}`;

  return (
    <details className={`evidence-record-details${compact ? " evidence-record-details--compact" : ""}`}>
      <summary>Transcript and record details</summary>
      <div className="evidence-record-details-body">
        <dl className="evidence-record-metadata">
          <div>
            <dt>Catalog</dt>
            <dd>{media.catalogId}</dd>
          </div>
          <div>
            <dt>Record type</dt>
            <dd>{media.kind}</dd>
          </div>
          <div>
            <dt>Date</dt>
            <dd>{media.date}</dd>
          </div>
          {media.metadata
            .filter((item) => !["catalog", "record type", "date"].includes(item.label.trim().toLowerCase()))
            .map((item) => (
            <div key={`${item.label}:${item.value}`}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
            ))}
        </dl>

        <section aria-labelledby={transcriptHeadingId} className="evidence-record-transcript">
          <h3 id={transcriptHeadingId}>Accessible transcript</h3>
          {media.transcript.kind === "table" ? (
            <div className="evidence-record-table-scroll" role="region" aria-label={`Scrollable transcript for ${media.title}`} tabIndex={0}>
              <table>
                <caption>{media.title}</caption>
                <thead>
                  <tr>
                    {media.transcript.columns.map((column) => <th key={column} scope="col">{column}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {media.transcript.rows.map((row, rowIndex) => (
                    <tr key={`${media.recordId}-row-${rowIndex}`}>
                      {row.map((cell, cellIndex) => (
                        <td key={`${media.recordId}-cell-${rowIndex}-${cellIndex}`}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="evidence-record-letter">
              {media.transcript.paragraphs.map((paragraph, index) => (
                <p key={`${media.recordId}-paragraph-${index}`}>{paragraph}</p>
              ))}
            </div>
          )}
        </section>
      </div>
    </details>
  );
}

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EvidenceRecordDetails } from "@/components/evidence-scan";
import { demoArchiveMediaForRecord } from "@/lib/demo-archive-media";

describe("evidence record details", () => {
  it("renders a structured table transcript with accessible headings and metadata", () => {
    const media = demoArchiveMediaForRecord("northstar-household-1901");
    if (!media) throw new Error("Missing household schedule media");

    const html = renderToStaticMarkup(createElement(EvidenceRecordDetails, { media }));

    expect(html).toMatch(/<details class="evidence-record-details">/);
    expect(html).toMatch(/Transcript and record details/);
    expect(html).toMatch(/Accessible transcript/);
    expect(html).toMatch(/<th scope="col">Name<\/th>/);
    expect(html).toMatch(/Samuel R\. Mercer/);
    expect(html).toMatch(/Research limit/);
  });

  it("renders a letter transcript as readable paragraphs", () => {
    const media = demoArchiveMediaForRecord("maeve-letter-1906");
    if (!media) throw new Error("Missing Maeve letter media");

    const html = renderToStaticMarkup(createElement(EvidenceRecordDetails, { media, compact: true }));

    expect(html).toMatch(/evidence-record-details--compact/);
    expect(html).toMatch(/Northstar Cove/);
    expect(html).toMatch(/Samuel practices his hand after supper/);
    expect(html).not.toMatch(/<table>/);
  });

  it("keeps transcript heading IDs unique when one scan supports multiple evidence claims", () => {
    const media = demoArchiveMediaForRecord("dna-match-export");
    if (!media) throw new Error("Missing DNA export media");

    const html = renderToStaticMarkup(createElement(
      "div",
      null,
      createElement(EvidenceRecordDetails, { media }),
      createElement(EvidenceRecordDetails, { media })
    ));
    const headingIds = [...html.matchAll(/<h3 id="([^"]+)">Accessible transcript<\/h3>/g)]
      .map((match) => match[1]);

    expect(headingIds).toHaveLength(2);
    expect(new Set(headingIds).size).toBe(2);
  });
});

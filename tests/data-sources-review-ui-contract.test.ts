import { readFile } from "node:fs/promises";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  canApplyReviewedChanges,
  canOpenReviewPanel,
  ChangeFieldComparison,
  ImportReport,
  isDataSourceWorkActive,
  reviewOpenAfterResume,
  runReviewDomId,
  supportsFieldLevelResolution
} from "@/components/data-sources-workspace";

describe("Data Sources review workspace contract", () => {
  it("never enables apply before a review summary has loaded successfully", () => {
    expect(canApplyReviewedChanges({
      status: "error",
      hasBlockingResolutions: false,
      summaryLoaded: false
    })).toBe(false);
    expect(canApplyReviewedChanges({
      status: "error",
      hasBlockingResolutions: false,
      summaryLoaded: true
    })).toBe(true);
  });

  it("keeps timed-out polling work active so refresh and disconnect stay locked", () => {
    expect(isDataSourceWorkActive("processing_delayed")).toBe(true);
    expect(isDataSourceWorkActive("failed")).toBe(false);
  });

  it("only offers field-level conflict resolution for entity types supported by apply", () => {
    expect(supportsFieldLevelResolution("person")).toBe(true);
    expect(supportsFieldLevelResolution("source")).toBe(true);
    for (const entityType of ["fact", "relationship", "citation", "family", "media"]) {
      expect(supportsFieldLevelResolution(entityType), entityType).toBe(false);
    }
  });

  it("offers searchable grouped review without bulk-accepting conflicts or deletions", async () => {
    const source = await readFile(
      path.join(process.cwd(), "components", "data-sources-workspace.tsx"),
      "utf8"
    );

    expect(source).toMatch(/Search (?:proposed )?changes/i);
    expect(source).toMatch(/Remote-only changes/i);
    expect(source).toMatch(/Local-only changes/i);
    expect(source).toMatch(/Conflicts require a decision/i);
    expect(source).toMatch(/Remote deletions keep local records/i);
    expect(source).toMatch(/Approve all safe incoming changes/i);
    expect(source).toMatch(/including unloaded pages/i);
    expect(source).toMatch(/acceptAllSafeIncoming/);
    expect(source).toMatch(/incoming addition decision\(s\) required/i);
    expect(source).toContain('change.classification === "remote_only"');
    expect(source).not.toMatch(/classification\s*!==\s*["']same["'][\s\S]{0,120}accept_incoming/);
  });

  it("applies with an idempotency key and exposes explicit rollback after success", async () => {
    const source = await readFile(
      path.join(process.cwd(), "components", "data-sources-workspace.tsx"),
      "utf8"
    );

    expect(source).toContain('"Idempotency-Key"');
    expect(source).toMatch(/Apply reviewed changes/i);
    expect(source).toMatch(/Undo this refresh/i);
    expect(source).toContain("/rollback");
    expect(source).toMatch(/restore point expired/i);
    expect(source).toMatch(/backupAvailable\s*\?/);
    expect(source).toMatch(/Download original export/i);
    expect(source).toContain("/download");
  });

  it("shows snapshot counts, warnings, unsupported records, and media reconciliation", () => {
    const html = renderToStaticMarkup(createElement(ImportReport, {
      report: {
        counts: {
          people: 12,
          sources: 3,
          facts: 8,
          relationships: 6,
          mediaReferences: 2,
          retainedMedia: 1,
          livingPeople: 2,
          privatePeople: 10,
          missingMedia: 1,
          ambiguousMedia: 1,
          unsupported: 1
        },
        warnings: ["One fictional extension record was retained verbatim."],
        sourceMetadata: {
          unsupportedRecords: [{ type: "_LOG", externalId: "@X1@" }],
          unsupportedTags: {
            total: 3,
            tags: [{ tag: "_MYSTERY", count: 3 }],
            truncated: false
          },
          missingMedia: [{ gedcomPath: "records/missing-page.jpg" }],
          ambiguousMedia: [{
            gedcomPath: "portrait.jpg",
            archivePaths: ["media/portrait.jpg", "photos/portrait.jpg"]
          }]
        },
        limits: {
          warnings: { total: 205, returned: 200, truncated: true }
        }
      }
    }));

    expect(html).toMatch(/Import report/i);
    expect(html).toMatch(/People[\s\S]*12/i);
    expect(html).toMatch(/Warnings/i);
    expect(html).toContain("One fictional extension record was retained verbatim.");
    expect(html).toMatch(/Unsupported data/i);
    expect(html).toContain("_LOG");
    expect(html).toContain("_MYSTERY");
    expect(html).toMatch(/Facts[\s\S]*8/i);
    expect(html).toMatch(/Relationships[\s\S]*6/i);
    expect(html).toMatch(/Media references[\s\S]*2/i);
    expect(html).toMatch(/Retained media files[\s\S]*1/i);
    expect(html).toMatch(/Living people[\s\S]*2/i);
    expect(html).toMatch(/showing 200 of 205/i);
    expect(html).toMatch(/Missing media/i);
    expect(html).toContain("records/missing-page.jpg");
    expect(html).toMatch(/Ambiguous media/i);
    expect(html).toContain("media/portrait.jpg");
    expect(html).toContain("photos/portrait.jpg");
  });

  it("renders base, local, and incoming field evidence carried by a change", () => {
    const html = renderToStaticMarkup(createElement(ChangeFieldComparison, {
      resolutionPayload: {
        values: {
          base: { name: "Mara Vale", residence: "Pine Harbor" },
          local: { name: "Mara Vale", residence: "Cedar Landing" },
          incoming: { name: "Mara Vail", residence: "Pine Harbor" }
        }
      }
    }));

    expect(html).toMatch(/Base/i);
    expect(html).toMatch(/Local/i);
    expect(html).toMatch(/Incoming/i);
    expect(html).toContain("Mara Vale");
    expect(html).toContain("Cedar Landing");
    expect(html).toContain("Mara Vail");
  });

  it("offers local or incoming choices for each field in a conflict", () => {
    const html = renderToStaticMarkup(createElement(ChangeFieldComparison, {
      editable: true,
      fieldDecisions: { residence: "accept_incoming" },
      resolutionPayload: {
        values: {
          base: { displayName: "Mara Vale", residence: "Pine Harbor" },
          local: { displayName: "Mara Vale", residence: "Cedar Landing" },
          incoming: { displayName: "Mara Vail", residence: "Pine Harbor" }
        }
      }
    }));

    expect(html).toMatch(/Field resolution for Residence/i);
    expect(html).toMatch(/Incoming/i);
    expect(html).toMatch(/Local/i);
    expect(html).toContain('value="accept_incoming" selected=""');
  });

  it("requires an explicit authenticated candidate before accepting an ambiguous identity", async () => {
    const source = await readFile(
      path.join(process.cwd(), "components", "data-sources-workspace.tsx"),
      "utf8"
    );

    expect(source).toMatch(/ambiguousLocalEntityIds/);
    expect(source).toMatch(/Select matching local record/i);
    expect(source).toMatch(/unresolvedIdentit(?:y|ies)/i);
    expect(source).toMatch(/localEntityId:\s*identityDecisions/);
  });

  it("uses bounded set-based SQL for resolution persistence", async () => {
    const source = await readFile(
      path.join(process.cwd(), "lib", "integrations", "store.ts"),
      "utf8"
    );

    expect(source).toMatch(/RESOLUTION_UPDATE_CHUNK_SIZE/);
    expect(source).toMatch(/jsonb_to_recordset/);
    expect(source).toMatch(/local_entity_id\s*=\s*input\.local_entity_id/);
  });

  it("loads one cursor page at a time instead of materializing a whole large tree", async () => {
    const source = await readFile(
      path.join(process.cwd(), "components", "data-sources-workspace.tsx"),
      "utf8"
    );

    expect(source).toMatch(/Load more changes/i);
    expect(source).toMatch(/nextCursor/i);
    expect(source).not.toMatch(/do\s*\{[\s\S]{0,800}while\s*\(cursor\)/i);
  });

  it("searches and filters on the server and gates apply on run-wide unresolved counts", async () => {
    const source = await readFile(
      path.join(process.cwd(), "components", "data-sources-workspace.tsx"),
      "utf8"
    );

    expect(source).toMatch(/searchParams\.set\("query"/);
    expect(source).toMatch(/searchParams\.set\("classification"/);
    expect(source).toMatch(/byClassification/);
    expect(source).toMatch(/summary\.unresolved/);
    expect(source).toMatch(/unresolved[^\n]*outside[^\n]*loaded/i);
  });

  it("resumes, reopens, and cancels connection-scoped browser work", async () => {
    const source = await readFile(
      path.join(process.cwd(), "components", "data-sources-workspace.tsx"),
      "utf8"
    );

    expect(source).toMatch(/Reopen review/i);
    expect(source).toMatch(/Cancel refresh/i);
    expect(source).toContain('method: "DELETE"');
    expect(source).toMatch(/integrations\/\$\{[^}]+\}\/sync-runs/);
  });

  it("offers an Open review affordance on the source row whenever a review is ready", () => {
    expect(canOpenReviewPanel({ phase: "review_ready", runId: "run-1" })).toBe(true);
    expect(canOpenReviewPanel({ phase: "review_ready", runId: "run-1", reviewOpen: true })).toBe(true);
    expect(canOpenReviewPanel({ phase: "review_ready", runId: "run-1", reviewOpen: false })).toBe(false);
    expect(canOpenReviewPanel({ phase: "applied", runId: "run-1", reviewOpen: true })).toBe(false);
    expect(canOpenReviewPanel({ phase: "review_ready" })).toBe(false);
    expect(canOpenReviewPanel(undefined)).toBe(false);
  });

  it("scrolls the status-row review actions to a focusable per-run review panel", async () => {
    const source = await readFile(
      path.join(process.cwd(), "components", "data-sources-workspace.tsx"),
      "utf8"
    );

    expect(runReviewDomId("run-1")).toBe("run-review-run-1");
    expect(source).toMatch(/Open review/);
    expect(source).toMatch(/id=\{runReviewDomId\(runId\)\}/);
    expect(source).toMatch(/tabIndex=\{-1\}/);
    expect(source).toMatch(/scrollIntoView/);
    expect(source).toMatch(/prefers-reduced-motion/);
    expect(source).toMatch(/focus\(\{ preventScroll: true \}\)/);
  });

  it("keeps a ready review's panel rendered after a full page reload", async () => {
    expect(reviewOpenAfterResume("review_ready")).toBe(true);
    expect(reviewOpenAfterResume("applied")).toBe(false);
    expect(reviewOpenAfterResume("rolled_back")).toBe(false);

    const source = await readFile(
      path.join(process.cwd(), "components", "data-sources-workspace.tsx"),
      "utf8"
    );

    expect(source).toMatch(/reviewOpen:\s*reviewOpenAfterResume\(phase\)/);
  });

  it("uses the new-source authority only for creation and preserves each remembered source on refresh", async () => {
    const source = await readFile(
      path.join(process.cwd(), "components", "data-sources-workspace.tsx"),
      "utf8"
    );

    expect(source).toMatch(/authority:\s*newSourceAuthority,\s*displayName:/);
    expect(source).toMatch(/declaredAuthority:\s*connection\.authority/);
    expect(source).not.toMatch(/candidate\.id\s*===\s*connection\.id\s*\?\s*\{[^}]*authority/);
    expect(source).toMatch(/Authoritative edits:/i);
  });

  it("paginates private media without replacing already loaded items", async () => {
    const source = await readFile(
      path.join(process.cwd(), "components", "data-sources-workspace.tsx"),
      "utf8"
    );

    expect(source).toMatch(/Load more private media/i);
    expect(source).toMatch(/cursor:\s*nextCursor/);
    expect(source).toMatch(/new Map\(current\.map/);
    expect(source).toMatch(/setNextCursor\(typeof payload\.nextCursor/);
  });

  it("uploads large packages directly with a one-use private ticket before completion", async () => {
    const source = await readFile(
      path.join(process.cwd(), "components", "data-sources-workspace.tsx"),
      "utf8"
    );

    expect(source).toContain("/artifacts/stage");
    expect(source).toContain("/artifacts/complete");
    expect(source).toMatch(/strategy === "presigned_post"/);
    expect(source).toMatch(/Object\.entries\(upload\.fields\)/);
    expect(source).toMatch(/form\.append\("file", file\)/);
    expect(source).toContain('import("@vercel/blob/client")');
    expect(source).toMatch(/Verifying upload integrity/i);
    expect(source).not.toMatch(/new FormData\(\)[\s\S]{0,300}\/artifacts[`'\"]/);
  });

  it("carries versioned media rights decisions and keeps reclassification private", async () => {
    const source = await readFile(
      path.join(process.cwd(), "components", "data-sources-workspace.tsx"),
      "utf8"
    );

    expect(source).toMatch(/mediaRightsAcknowledgement/);
    expect(source).toMatch(/DESKTOP_MEDIA_RIGHTS_ACKNOWLEDGEMENT_VERSION/);
    expect(source).toMatch(/MEDIA_OWNERSHIP_ATTESTATION_VERSION/);
    expect(source).toMatch(/Mark as user-owned/i);
    expect(source).toMatch(/Still private; not publishable or AI eligible/i);
    expect(source).toContain("/api/integration-media/");
  });

  it("disconnects a remembered source only after confirming imported research remains", async () => {
    const source = await readFile(
      path.join(process.cwd(), "components", "data-sources-workspace.tsx"),
      "utf8"
    );

    expect(source).toMatch(/Disconnect data source/i);
    expect(source).toMatch(/imported research (?:will )?remain/i);
    expect(source).toMatch(/api\/integrations\/\$\{encodeURIComponent\(connectionId\)\}/);
  });
});

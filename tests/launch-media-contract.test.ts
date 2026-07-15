import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const files = {
  builder: new URL("../scripts/build-launch-video.mjs", import.meta.url),
  capture: new URL("../scripts/capture-launch-media.ts", import.meta.url),
  component: new URL("../site/components/launch-media.tsx", import.meta.url),
  content: new URL("../site/lib/launch-media-content.json", import.meta.url),
  footer: new URL("../site/components/site-footer.tsx", import.meta.url),
  marketingConfig: new URL("../site/next.config.ts", import.meta.url),
  orchestrator: new URL("../scripts/run-launch-media-capture.mjs", import.meta.url),
  text: new URL("../scripts/launch-media-text.mjs", import.meta.url),
  product: new URL("../site/app/product/page.tsx", import.meta.url),
  publisher: new URL("../scripts/publish-launch-media.mjs", import.meta.url),
  runbook: new URL("../docs/launch-media-runbook.md", import.meta.url),
  validator: new URL("../scripts/validate-launch-media.mjs", import.meta.url)
} as const;

describe("synthetic launch-media contract", () => {
  it("captures exactly eight visibly synthetic, version-bound product frames", async () => {
    const [capture, contentSource] = await Promise.all([
      readFile(files.capture, "utf8"),
      readFile(files.content, "utf8")
    ]);
    const content = JSON.parse(contentSource) as {
      captures: Array<{ filename: string }>;
    };
    const names = content.captures.map((record) => record.filename);
    expect(names).toEqual([
      "01-synthetic-dashboard.webp",
      "02-durable-gedcom-source.webp",
      "03-review-before-apply.webp",
      "04-evidence-and-hypotheses.webp",
      "05-sources-in-context.webp",
      "06-deterministic-quality.webp",
      "07-scoped-developer-api.webp",
      "08-export-and-control.webp"
    ]);
    expect(capture).toContain("checkedOutCommit !== configuration.releaseSha");
    expect(capture).toContain('gitOutput(["status", "--porcelain", "--untracked-files=all"])');
    expect(capture).toContain('hostname !== "127.0.0.1"');
    expect(capture).toContain('context.route("**/*"');
    expect(capture).toContain("context.routeWebSocket");
    expect(capture).toContain("requestOrigin !== configuration.origin");
    expect(capture).toContain('response.status() !== 200');
    expect(capture).toContain('body.status !== "ok"');
    expect(capture).toContain("body.database.datasetModeMatches !== true");
    expect(capture).toContain("body.api.configured !== true");
    expect(capture).toContain("body.storage.configured !== true");
    expect(capture).toContain('getByText("Synthetic demo", { exact: true })');
    expect(capture).toContain('locator(".sync-change-groups")');
    expect(capture).toContain("did not observe the GEDCOM connection response");
    expect(capture).toContain("did not observe the GEDCOM refresh-queue response");
    expect(capture).toContain('url.pathname === "/api/sources"');
    expect(capture).toContain("did not observe the settled source-register response");
    expect(capture).toContain("settledSourceResponse.status() !== 200");
    expect(capture).toContain('section.people-search-card[aria-busy="false"]');
    expect(capture).toContain('getByText("No API tokens yet.", { exact: true })');
    expect(capture).toContain('import launchMediaContent from "../site/lib/launch-media-content.json"');
    expect(capture).not.toContain("fullPage: true");
  });

  it("builds an exact 90-second captioned video from the approved frame sequence", async () => {
    const [builder, contentSource, textHelper] = await Promise.all([
      readFile(files.builder, "utf8"),
      readFile(files.content, "utf8"),
      readFile(files.text, "utf8")
    ]);
    const content = JSON.parse(contentSource) as {
      segments: Array<{ durationSeconds: number; image: string; text: string }>;
    };
    const durations = content.segments.map((segment) => segment.durationSeconds);
    expect(durations).toEqual([10, 12, 12, 13, 11, 11, 12, 9]);
    expect(durations.reduce((total, duration) => total + duration, 0)).toBe(90);
    expect(builder).toContain('"-map_metadata", "-1"');
    expect(builder).toContain('"-movflags", "+faststart"');
    expect(builder).toContain("Math.abs(audioDuration - 90) > 0.08");
    expect(builder).toContain("aevalsrc=0.018*sin(2*PI*110*t)");
    expect(builder).toContain("deterministic wordless mathematical tone bed");
    expect(builder).not.toContain("/usr/bin/say");
    expect(textHelper).toContain("WEBVTT");
    expect(textHelper).toContain("Fictional Hartwell-Mercer demonstration");
    expect(textHelper).toContain("captionLineCharacters = 42");
    expect(builder).toContain('import launchMediaContent from "../site/lib/launch-media-content.json"');
    expect(builder).toContain('Math.abs(duration - 90) > 0.08');

    const { buildTranscript, buildWebVtt } = await import("../scripts/launch-media-text.mjs");
    const vtt = buildWebVtt(content.segments);
    const cues = vtt.split("\n\n").slice(2).filter(Boolean);
    expect(cues.length).toBeGreaterThan(8);
    for (const cue of cues) {
      const lines = cue.trim().split("\n");
      expect(lines.slice(1).length).toBeLessThanOrEqual(2);
      expect(lines.slice(1).every((line: string) => line.length <= 42)).toBe(true);
    }
    expect(vtt).toContain("00:01:30.000");
    const transcript = buildTranscript(content.segments, "a".repeat(40));
    expect(transcript.match(/^## .+$/gm)).toEqual([
      "## 0:00–0:10",
      "## 0:10–0:22",
      "## 0:22–0:34",
      "## 0:34–0:47",
      "## 0:47–0:58",
      "## 0:58–1:09",
      "## 1:09–1:21",
      "## 1:21–1:30"
    ]);
  });

  it("keeps capture disposable and publication a separate acknowledged action", async () => {
    const [orchestrator, publisher, validator] = await Promise.all([
      readFile(files.orchestrator, "utf8"),
      readFile(files.publisher, "utf8"),
      readFile(files.validator, "utf8")
    ]);
    expect(orchestrator).toContain("I authorize creation and teardown of this exact disposable local launch-media cell.");
    expect(orchestrator).toContain("KINRESOLVE_BETA_APPLICATIONS_ENABLED: \"false\"");
    expect(orchestrator).toContain("safeHostEnvironment()");
    expect(orchestrator).toContain("Launch-media orchestration refuses local Next environment file");
    expect(orchestrator).toContain('gitAt(callerRoot, ["status", "--porcelain", "--untracked-files=all"])');
    expect(orchestrator).toContain('"clone", "--quiet", "--no-checkout", "--no-hardlinks"');
    expect(orchestrator).toContain('if (!/^unix:\\/\\//.test(dockerEndpoint))');
    expect(orchestrator).toContain('["--context", dockerContext, "rm", "--force", container]');
    expect(orchestrator.indexOf("createdContainers.push(postgresContainer)")).toBeGreaterThan(
      orchestrator.indexOf('postgresImage\n  ]);')
    );
    expect(orchestrator.indexOf("createdContainers.push(minioContainer)")).toBeGreaterThan(
      orchestrator.indexOf('minioImage, "server", "/data", "--address", ":9000"\n  ]);')
    );
    expect(orchestrator).toContain("for (const filename of approvedPackageFiles)");
    expect(orchestrator.match(/safeSyntheticDiagnostics: true/g)).toHaveLength(2);
    expect(orchestrator).toContain("safeSyntheticFailureDiagnostic(result.stderr)");
    expect(orchestrator).toContain('diagnostic.replaceAll(value, "<redacted>")');
    expect(orchestrator).toContain('"<redacted-database-url>"');
    expect(orchestrator).toContain('"<redacted-api-token>"');
    expect(orchestrator).toContain("Source provenance changed before launch-media copy-back.");
    expect(orchestrator).toContain("Do not publish automatically.");
    expect(orchestrator).not.toContain("publish-launch-media.mjs");
    expect(publisher).toContain("I verified this exact generated package contains only fictional Hartwell-Mercer launch media.");
    expect(validator).toContain('spawnSync("git", ["merge-base", "--is-ancestor"');
    expect(validator).toContain("metadata.exif");
    expect(validator).toContain("kinresolve_browser_canary");
  });

  it("publishes accessible media with centralized hosted-availability claims", async () => {
    const [component, contentSource, footer, marketingConfig, product, runbook] = await Promise.all([
      readFile(files.component, "utf8"),
      readFile(files.content, "utf8"),
      readFile(files.footer, "utf8"),
      readFile(files.marketingConfig, "utf8"),
      readFile(files.product, "utf8"),
      readFile(files.runbook, "utf8")
    ]);
    expect(product).toContain("<LaunchMedia />");
    expect(component.match(/<Image/g)).toHaveLength(1);
    expect(component).toContain('kind="captions"');
    expect(component).toContain('className="eyebrow eyebrow-light"');
    expect(component).toContain("Read the 90-second transcript");
    expect(component).toContain("it contains no synthetic or recorded voice");
    expect(component).toContain('import { betaStatus } from "@/lib/beta-status"');
    expect(component).toContain("{betaStatus.launchMediaDisclaimer}");
    expect(component).toContain('href={site.sourceUrl}>Source for this build</a>');
    expect(component).toContain('import launchMediaContent from "@/lib/launch-media-content.json"');
    const content = JSON.parse(contentSource) as { captures: unknown[]; segments: unknown[] };
    expect(content.captures).toHaveLength(8);
    expect(content.segments).toHaveLength(8);
    expect(footer).toContain("Source for this build");
    expect(footer).toContain("site.sourceCommit.slice(0, 12)");
    expect(marketingConfig).toContain("The marketing build source commit does not match the checked-out revision.");
    expect(marketingConfig).toContain("NEXT_PUBLIC_KINRESOLVE_SOURCE_COMMIT_SHA");
    expect(runbook).toContain("Mandatory human privacy review");
    expect(runbook).toMatch(/Do not edit a screenshot to conceal a\s+problem/);
    expect(runbook).toContain("Commit the generated `site/public/assets/launch/` directory as a second commit");
  });
});

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const outputRoot = resolve("out");
const marketingReleaseMode = parseMarketingReleaseMode(
  process.env.KINRESOLVE_MARKETING_RELEASE_MODE
);
const marketingDemoMode = parseMarketingDemoMode(process.env.KINRESOLVE_MARKETING_DEMO_MODE);

function parseMarketingReleaseMode(value) {
  if (value === undefined || value === "prelaunch") return "prelaunch";
  if (value === "application" || value === "api-launch") return value;
  throw new Error(
    "KINRESOLVE_MARKETING_RELEASE_MODE must be exactly prelaunch, application, or api-launch."
  );
}

function parseMarketingDemoMode(value) {
  if (value === undefined || value === "pending") return "pending";
  if (value === "live") return "live";
  throw new Error("KINRESOLVE_MARKETING_DEMO_MODE must be exactly pending or live.");
}

if (!existsSync(outputRoot)) {
  throw new Error("Static export not found. Run `npm run build` before checking it.");
}

function walk(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const absolute = join(directory, entry);
    return statSync(absolute).isDirectory() ? walk(absolute) : [absolute];
  });
}

function targetFor(rawUrl) {
  const cleanUrl = rawUrl.split("#", 1)[0].split("?", 1)[0];
  if (!cleanUrl || !cleanUrl.startsWith("/")) return null;
  const relative = decodeURIComponent(cleanUrl.slice(1));
  if (!relative) return join(outputRoot, "index.html");
  const direct = join(outputRoot, relative);
  if (existsSync(direct) && statSync(direct).isFile()) return direct;
  return join(direct, "index.html");
}

const htmlFiles = walk(outputRoot).filter((file) => file.endsWith(".html"));
const problems = [];

for (const file of htmlFiles) {
  const html = readFileSync(file, "utf8");

  for (const [, attribute, url] of html.matchAll(/\b(href|src)=["']([^"']+)["']/g)) {
    if (url.startsWith("#") || url.startsWith("mailto:") || url.startsWith("tel:") || url.startsWith("data:")) continue;
    const target = targetFor(url);
    if (target && !existsSync(target)) {
      problems.push(`${file}: ${attribute} points to missing ${url}`);
    }
  }

  for (const forbidden of ["href=\"#\"", "example.com", "kinsleuth.com", "MIT open source", "production-ready genealogy platform"]) {
    if (html.includes(forbidden)) problems.push(`${file}: contains forbidden placeholder or claim ${forbidden}`);
  }

  for (const forbiddenClaim of [
    "current private beta",
    "a working beta",
    "available in the current beta",
    "private beta in development",
    "hosted access is rolling out"
  ]) {
    if (html.toLowerCase().includes(forbiddenClaim)) {
      problems.push(`${file}: contains stale hosted-beta claim ${forbiddenClaim}`);
    }
  }
}

const requiredRoutes = ["index.html", "product/index.html", "method/index.html", "developers/index.html", "privacy/index.html", "open-source/index.html", "about/index.html", "beta/index.html", "beta/thanks/index.html", "challenge/index.html", "openapi/kinresolve-v1.yaml", "icon.png", "manifest.webmanifest", "robots.txt", "sitemap.xml"];
for (const route of requiredRoutes) {
  if (!existsSync(join(outputRoot, route))) problems.push(`Missing required export: ${route}`);
}

const home = readFileSync(join(outputRoot, "index.html"), "utf8");
for (const metadata of ["og:image", "twitter:image", "canonical", "rel=\"icon\""]) {
  if (!home.includes(metadata)) problems.push(`Homepage is missing ${metadata} metadata.`);
}

const releaseClaims = {
  prelaunch: {
    headline: "Private beta applications are open.",
    rollout: "Invitations have not started; hosted access begins only after the launch gates pass.",
    productBoundary: "Hosted invitations have not started, and the API preview is not yet available.",
    privacyApi: "The hosted API remains unavailable until its release, edge-limit, canary, and revocation gates pass.",
    privacyLegal: "The approved participation terms, privacy notice, and cohort boundary have not been published.",
    developerBoundary: "The contract is implemented in source. Hosted access stays disabled until the SHA-bound staging, edge-rate-limit, production, and revocation gates pass",
    methodBoundary: "Hosted access remains a proposed, gated cohort.",
    cohortContract: "Proposed cohort-one contract",
    mediaBoundary: "This is proof of the source product—not a claim that hosted invitations or the API are already live."
  },
  application: {
    headline: "Hosted private beta is live.",
    rollout: "Access is invitation-only for approved participants; the hosted API is not available in this release.",
    productBoundary: "Hosted private beta access is live for approved participants; the API preview is not available in this release.",
    privacyApi: "The hosted API is not available in this release.",
    privacyLegal: "The approved participation terms, privacy notice, and cohort boundary are published as exact versioned documents",
    developerBoundary: "The hosted private beta is live for approved participants, but API v1 is not available in this release.",
    methodBoundary: "Hosted access is live only for approved private-beta participants.",
    cohortContract: "Hosted cohort-one contract",
    mediaBoundary: "Hosted availability is limited to approved private-beta participants, and the API is not available in this release."
  },
  "api-launch": {
    headline: "Hosted private beta and API v1 are live.",
    rollout: "Access remains invitation-only; API v1 is available only to approved participants for archives they own.",
    productBoundary: "Hosted private beta and API v1 access are live only for approved participants and archives they own.",
    privacyApi: "API v1 is available only to approved private-beta participants for archives they own",
    privacyLegal: "The approved participation terms, privacy notice, and cohort boundary are published as exact versioned documents",
    developerBoundary: "API v1 is available only to approved private-beta participants for archives they own.",
    methodBoundary: "Hosted access is live only for approved private-beta participants.",
    cohortContract: "Hosted cohort-one contract",
    mediaBoundary: "Hosted private-beta and API access are limited to approved participants and archives they own."
  }
};
const expectedReleaseClaims = releaseClaims[marketingReleaseMode];
const expectedBetaStatus = [expectedReleaseClaims.headline, expectedReleaseClaims.rollout];
for (const [page, surface] of [
  ["index.html", "home"],
  ["product/index.html", "product"],
  ["beta/index.html", "beta"]
]) {
  const html = readFileSync(join(outputRoot, page), "utf8");
  if (!html.includes(`data-beta-status-surface="${surface}"`)) {
    problems.push(`${page}: is not wired to the centralized beta-status surface.`);
  }
  for (const wording of expectedBetaStatus) {
    if (!html.includes(wording)) problems.push(`${page}: is missing beta status wording: ${wording}`);
  }
}
for (const file of htmlFiles) {
  const html = readFileSync(file, "utf8");
  if (!html.includes('data-beta-status-surface="footer"')) {
    problems.push(`${file}: footer is not wired to the centralized beta-status surface.`);
  }
  if (!html.includes(`data-marketing-release-mode="${marketingReleaseMode}"`)) {
    problems.push(`${file}: footer does not identify marketing release mode ${marketingReleaseMode}.`);
  }
}

const htmlCorpus = htmlFiles.map((file) => readFileSync(file, "utf8")).join("\n");
for (const [mode, claims] of Object.entries(releaseClaims)) {
  if (mode === marketingReleaseMode) continue;
  for (const claim of [claims.headline, claims.rollout, claims.productBoundary]) {
    if (htmlCorpus.includes(claim)) {
      problems.push(`Static export for ${marketingReleaseMode} contains ${mode} claim: ${claim}`);
    }
  }
}

const demoClaims = {
  pending: {
    heroCtaLabel: "Try Kin Resolve",
    heroSourceNote: "Source available under AGPL-3.0-only."
  },
  live: {
    heroCtaLabel: "Solve the passenger mystery",
    heroCtaNote: "No signup · about 2 minutes · every record is fictional.",
    heroStatusLine: "The public demo is live. The hosted workspace remains an invitation-only private beta."
  }
};
if (marketingDemoMode === "live") {
  for (const claim of [demoClaims.live.heroCtaLabel, demoClaims.live.heroCtaNote, demoClaims.live.heroStatusLine]) {
    if (!home.includes(claim)) problems.push(`Homepage is missing the live demo claim: ${claim}`);
  }
  for (const [description, replaced] of [
    ["pending hero CTA label", demoClaims.pending.heroCtaLabel],
    ["pending hero source note", demoClaims.pending.heroSourceNote]
  ]) {
    if (home.includes(replaced)) {
      problems.push(`Live-demo homepage still contains the ${description}: ${replaced}`);
    }
  }
} else {
  for (const claim of [demoClaims.pending.heroCtaLabel, demoClaims.pending.heroSourceNote]) {
    if (!home.includes(claim)) problems.push(`Homepage is missing the pending demo copy: ${claim}`);
  }
  for (const claim of [demoClaims.live.heroCtaLabel, demoClaims.live.heroCtaNote, demoClaims.live.heroStatusLine]) {
    if (htmlCorpus.includes(claim)) {
      problems.push(`Static export for the ${marketingDemoMode} demo mode contains live-demo claim: ${claim}`);
    }
  }
}

const pageUrls = new Map([
  ["about/index.html", "https://kinresolve.com/about/"],
  ["beta/index.html", "https://kinresolve.com/beta/"],
  ["beta/thanks/index.html", "https://kinresolve.com/beta/thanks/"],
  ["challenge/index.html", "https://kinresolve.com/challenge/"],
  ["developers/index.html", "https://kinresolve.com/developers/"],
  ["method/index.html", "https://kinresolve.com/method/"],
  ["open-source/index.html", "https://kinresolve.com/open-source/"],
  ["privacy/index.html", "https://kinresolve.com/privacy/"],
  ["product/index.html", "https://kinresolve.com/product/"]
]);
for (const [page, expectedUrl] of pageUrls) {
  const html = readFileSync(join(outputRoot, page), "utf8");
  if (!html.includes(`<link rel="canonical" href="${expectedUrl}"`)) {
    problems.push(`${page}: canonical URL does not match ${expectedUrl}`);
  }
  if (!html.includes(`<meta property="og:url" content="${expectedUrl}"`)) {
    problems.push(`${page}: Open Graph URL does not match ${expectedUrl}`);
  }
}

const challenge = readFileSync(join(outputRoot, "challenge/index.html"), "utf8");
if (!challenge.includes('<meta name="robots" content="noindex, nofollow"')) {
  problems.push("Challenge export must remain noindex and nofollow.");
}
const betaThanks = readFileSync(join(outputRoot, "beta/thanks/index.html"), "utf8");
if (!/<meta name="robots" content="noindex, nofollow"/i.test(betaThanks)) {
  problems.push("Beta thank-you export must remain noindex and nofollow.");
}
const sitemap = readFileSync(join(outputRoot, "sitemap.xml"), "utf8");
if (sitemap.includes("/beta/thanks/")) {
  problems.push("Noindex beta thank-you page must remain out of the sitemap.");
}
if (!/Applying does not create an account, guarantee access, or accept private-beta participation terms/i.test(betaThanks)) {
  problems.push("Beta thank-you export is missing its account and consent boundary.");
}
if (!/Everything here is fictional/i.test(challenge) || !/Hartwell[–-]Mercer/i.test(challenge)) {
  problems.push("Challenge export is missing its fictional Hartwell–Mercer disclosure.");
}
for (const region of ["record-inspector", "transcript", "clue-notebook", "conclusion"]) {
  if (!challenge.includes(`data-challenge-region="${region}"`)) {
    problems.push(`Challenge export is missing the immersive ${region} region.`);
  }
}
if (!home.includes('href="/challenge/"')) {
  problems.push("Homepage is missing the research challenge discovery link.");
}

const developers = readFileSync(join(outputRoot, "developers/index.html"), "utf8");
for (const required of [
  "$KINRESOLVE_TOKEN",
  "/openapi/kinresolve-v1.yaml",
  "60",
  "10,000",
  "archive:export",
  "Developer Preview"
]) {
  if (!developers.includes(required)) problems.push(`Developers page is missing ${required}.`);
}
if (/Bearer\s+kr_beta_[A-Za-z0-9_-]+/i.test(developers)) {
  problems.push("Developers page contains a token-shaped example instead of $KINRESOLVE_TOKEN.");
}
if (!developers.includes(expectedReleaseClaims.developerBoundary)) {
  problems.push(`Developers page is missing the ${marketingReleaseMode} API availability boundary.`);
}

const canonicalOpenApi = readFileSync(resolve("../openapi/kinresolve-v1.yaml"), "utf8");
const publishedOpenApi = readFileSync(join(outputRoot, "openapi/kinresolve-v1.yaml"), "utf8");
if (publishedOpenApi !== canonicalOpenApi) {
  problems.push("Published OpenAPI document does not exactly match the canonical root source.");
}

const beta = readFileSync(join(outputRoot, "beta/index.html"), "utf8");
if (!beta.includes(expectedReleaseClaims.cohortContract)) {
  problems.push(`Beta page is missing the ${marketingReleaseMode} cohort contract state.`);
}
for (const [description, pattern] of [
  ["plain GEDCOM limit", /plain \.ged or \.gedcom[\s\S]*10 MiB \(10,485,760 bytes\)[\s\S]*40,000 people/i],
  ["DNA exclusion", /DNA[\s\S]*disabled for cohort one/i],
  ["external-AI exclusion", /external-provider AI[\s\S]*disabled for cohort one/i],
  ["binary-media exclusion", /binary source attachments[\s\S]*media packages[\s\S]*disabled for cohort one/i],
  ["real-data publishing exclusion", /real-data public publishing[\s\S]*disabled for cohort one/i],
  ["support posture", /one-business-day support acknowledgement target[\s\S]*not an uptime or response-time SLA/i],
  ["communications-only consent", /consents only to beta communications[\s\S]*does not accept participation terms/i],
  ["synthetic-first boundary", /Start synthetic[\s\S]*Real family data remains prohibited until every real-data gate/i]
]) {
  if (!pattern.test(beta)) problems.push(`Beta page is missing its ${description}.`);
}
const applicationMode = process.env.KINRESOLVE_MARKETING_BETA_APPLICATION_MODE === "application";
if (applicationMode) {
  if (!beta.includes('action="https://app.kinresolve.com/api/public/beta-applications"')) {
    problems.push("Beta application mode is missing its canonical product endpoint.");
  }
  if (!beta.includes('method="post"') || !beta.toLowerCase().includes('enctype="application/x-www-form-urlencoded"')) {
    problems.push("Beta application mode is not a native URL-encoded POST.");
  }
  for (const field of ["name", "email", "researcher_type", "current_tool", "archive_size_band", "workflow", "consent_version", "consent", "website"]) {
    if (!beta.includes(`name="${field}"`)) problems.push(`Beta application mode is missing ${field}.`);
  }
  if (/<textarea\b/i.test(beta) || /name="(?:redirect|return|next)"/i.test(beta)) {
    problems.push("Beta application mode exposes free text or a caller-controlled redirect field.");
  }
  if (!/stores these application fields for up to 90 days/i.test(beta)) {
    problems.push("Beta application mode is missing its truthful storage disclosure.");
  }
} else {
  if (!beta.includes(`action="mailto:beta@kinresolve.com`)) {
    problems.push("Beta mail fallback is missing its configured mailto destination.");
  }
  if (!/marketing site does not store it/i.test(beta)) {
    problems.push("Beta mail fallback is missing its truthful storage disclosure.");
  }
}
const submitButton = beta.match(/<button([^>]*)>(Open email application|Submit application)<\/button>/);
if (!submitButton) {
  problems.push("Beta submission does not expose exactly one recognized intake state.");
} else {
  const [, attributes, label] = submitButton;
  const disabled = /\bdisabled(?:=""|(?=\s|$))/.test(attributes);
  if (disabled) problems.push(`${label} is unexpectedly disabled.`);
}
if (!beta.includes('href="/privacy/"')) {
  problems.push("Beta application is missing its data-practices link.");
}

const privacy = readFileSync(join(outputRoot, "privacy/index.html"), "utf8");
for (const [description, pattern] of [
  ["isolated-cell boundary", /one isolated deployment, database, object store, secret set, and archive/i],
  ["deletion-state distinction", /A deletion request is not a completed deletion/i],
  ["retained-backup distinction", /Primary deletion and retained-backup expiry are separate/i],
  ["proposed retention disclaimer", /planning values—not live promises/i],
  ["communications-only legal boundary", /beta application consents only to beta communications[\s\S]*does not accept hosted participation terms/i],
  ["support route", /support@kinresolve\.com/i],
  ["security route", /security@kinresolve\.com/i],
  ["no-family-data email rule", /Never email family records, GEDCOM files, private screenshots, passwords, cookies, API tokens, source images, or genetic information/i]
]) {
  if (!pattern.test(privacy)) problems.push(`Privacy page is missing its ${description}.`);
}
for (const [description, claim] of [
  ["API availability boundary", expectedReleaseClaims.privacyApi],
  ["legal-document state", expectedReleaseClaims.privacyLegal]
]) {
  if (!privacy.includes(claim)) {
    problems.push(`Privacy page is missing its ${marketingReleaseMode} ${description}: ${claim}`);
  }
}

const product = readFileSync(join(outputRoot, "product/index.html"), "utf8");
if (!product.includes(expectedReleaseClaims.productBoundary)) {
  problems.push(`Product page is missing its ${marketingReleaseMode} hosted/API boundary.`);
}
if (!product.includes(expectedReleaseClaims.mediaBoundary)) {
  problems.push(`Product page is missing its ${marketingReleaseMode} launch-media boundary.`);
}
const method = readFileSync(join(outputRoot, "method/index.html"), "utf8");
if (!method.includes(expectedReleaseClaims.methodBoundary)) {
  problems.push(`Method page is missing its ${marketingReleaseMode} hosted-access boundary.`);
}
const manifest = readFileSync(join(outputRoot, "manifest.webmanifest"), "utf8");
if (!manifest.includes('"src":"/icon.png"')) problems.push("Manifest is missing the generated favicon.");
if (existsSync(join(outputRoot, "api"))) {
  problems.push("Static marketing export unexpectedly contains an API surface.");
}

if (problems.length) {
  throw new Error(`Static export verification failed:\n${problems.map((problem) => `- ${problem}`).join("\n")}`);
}

console.log(`Verified ${htmlFiles.length} HTML pages, internal assets and links, required routes, and social metadata.`);

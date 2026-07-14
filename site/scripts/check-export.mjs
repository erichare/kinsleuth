import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const outputRoot = resolve("out");

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
}

const requiredRoutes = ["index.html", "product/index.html", "method/index.html", "privacy/index.html", "open-source/index.html", "about/index.html", "beta/index.html", "challenge/index.html", "icon.png", "manifest.webmanifest", "robots.txt", "sitemap.xml"];
for (const route of requiredRoutes) {
  if (!existsSync(join(outputRoot, route))) problems.push(`Missing required export: ${route}`);
}

const home = readFileSync(join(outputRoot, "index.html"), "utf8");
for (const metadata of ["og:image", "twitter:image", "canonical", "rel=\"icon\""]) {
  if (!home.includes(metadata)) problems.push(`Homepage is missing ${metadata} metadata.`);
}

const pageUrls = new Map([
  ["about/index.html", "https://kinresolve.com/about/"],
  ["beta/index.html", "https://kinresolve.com/beta/"],
  ["challenge/index.html", "https://kinresolve.com/challenge/"],
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

const beta = readFileSync(join(outputRoot, "beta/index.html"), "utf8");
if (!beta.includes(`action="mailto:beta@kinresolve.com`)) {
  problems.push("Beta application is missing its configured mailto destination.");
}
const submitButton = beta.match(/<button([^>]*)>(Open email application|Email routing pending)<\/button>/);
if (!submitButton) {
  problems.push("Beta submission does not expose exactly one recognized intake state.");
} else {
  const [, attributes, label] = submitButton;
  const disabled = /\bdisabled(?:=""|(?=\s|$))/.test(attributes);
  if (label === "Open email application" && disabled) {
    problems.push("Active beta submission is unexpectedly disabled.");
  }
  if (label === "Email routing pending" && !disabled) {
    problems.push("Inactive beta submission is not disabled.");
  }
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

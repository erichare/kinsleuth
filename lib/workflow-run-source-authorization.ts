/**
 * Shared source-event authorization for the repository's workflow_run
 * safety/cleanup/containment handlers.
 *
 * Each live handler currently embeds its own validation of the triggering
 * workflow_run event before acting. This module centralizes the union of
 * those checks behind one pure, fail-closed function so adoption PRs can
 * replace the embedded checks mechanically. The exported config profiles in
 * `workflowRunSourceAuthorizationProfiles` correspond to the live handlers:
 *
 * - `releaseContainment` -> .github/workflows/release-containment.yml
 *   Source: "Release Kin Resolve beta candidate" (vercel-release.yml).
 *   The display title pins the exact source run ID and attempt; no values
 *   are extracted beyond run_id, run_attempt, and head_sha.
 * - `publicDemoSafety` -> .github/workflows/public-demo-safety.yml
 *   Source: "Release Kin Resolve public demo" (public-demo-release.yml).
 *   The display title embeds the head SHA, run ID, and attempt and extracts
 *   `action` (release | rollback | contain).
 * - `holdingSafety` -> .github/workflows/holding-safety.yml
 *   Source: "Deploy Kin Resolve static holding page" (vercel-holding.yml).
 *   The display title selects `target` (beta-staging | production |
 *   public-demo) and derives the matching `safety_environment` output.
 * - `productionBackupCleanup` -> .github/workflows/production-backup-cleanup.yml
 *   Source: production-backup.yml. Adoption must add
 *   `expectedSourceWorkflowId` from vars.PRODUCTION_BACKUP_WORKFLOW_ID; the
 *   profile sets `requiresExpectedSourceWorkflowId` so a config that omits
 *   the pin is rejected at validation time.
 *   The live handler checks no workflow name and no display title.
 * - `recoveryCleanup` -> .github/workflows/recovery-cleanup.yml
 *   Source: recovery-evidence.yml. Adoption must add
 *   `expectedSourceWorkflowId` from vars.RECOVERY_EVIDENCE_WORKFLOW_ID; the
 *   profile sets `requiresExpectedSourceWorkflowId` so a config that omits
 *   the pin is rejected at validation time.
 *   The live handler checks no workflow name and no display title.
 *
 * Every profile still requires `currentRepository` (from GITHUB_REPOSITORY)
 * at call time. The cleanup handlers' lease-artifact discovery is out of
 * scope and stays in the workflows.
 */

type JsonObject = Record<string, unknown>;

export const requiredWorkflowRunEventAction = "completed";

export const workflowRunFailureConclusions = Object.freeze([
  "failure",
  "cancelled",
  "timed_out"
] as const);

export const workflowRunDispatchEvents = Object.freeze(["workflow_dispatch"] as const);

/**
 * Placeholder names bound to validated event fields inside display title
 * templates. These are always emitted as outputs.
 */
export const builtinWorkflowRunPlaceholderNames = Object.freeze([
  "run_id",
  "run_attempt",
  "head_sha"
] as const);

/**
 * Every output name the CLI writes to GITHUB_OUTPUT itself. Config-defined
 * captures and fixed outputs must not shadow any of these: a duplicate
 * `authorized=` line in GITHUB_OUTPUT would let the later (config-controlled)
 * assignment win over the CLI's authorization verdict.
 */
export const reservedWorkflowRunOutputNames = Object.freeze([
  "authorized",
  ...builtinWorkflowRunPlaceholderNames
] as const);

export type WorkflowRunDisplayTitleTemplate = Readonly<{
  template: string;
  captures?: Readonly<Record<string, readonly string[]>>;
  outputs?: Readonly<Record<string, string>>;
}>;

export type WorkflowRunSourceAuthorizationConfig = Readonly<{
  currentRepository: string;
  expectedSourceWorkflowPath: string;
  expectedSourceWorkflowName?: string;
  expectedSourceWorkflowId?: string;
  /**
   * When true the config is rejected unless `expectedSourceWorkflowId` is
   * present. Profiles whose live handlers pin the numeric workflow ID set
   * this so an adopter cannot spread the profile and silently drop the pin.
   */
  requiresExpectedSourceWorkflowId?: boolean;
  allowedSourceEvents: readonly string[];
  allowedSourceConclusions: readonly string[];
  requiredHeadBranch: string;
  displayTitleTemplates?: readonly WorkflowRunDisplayTitleTemplate[];
}>;

export type WorkflowRunSourceAuthorizationProfile = Omit<
  WorkflowRunSourceAuthorizationConfig,
  "currentRepository" | "expectedSourceWorkflowId"
>;

export type AuthorizedWorkflowRunSource = Readonly<{
  authorized: true;
  outputs: Readonly<Record<string, string>>;
}>;

export type UnauthorizedWorkflowRunSource = Readonly<{
  authorized: false;
  reason: string;
}>;

export type WorkflowRunSourceAuthorization =
  | AuthorizedWorkflowRunSource
  | UnauthorizedWorkflowRunSource;

export const workflowRunSourceAuthorizationProfiles: Readonly<
  Record<
    | "releaseContainment"
    | "publicDemoSafety"
    | "holdingSafety"
    | "productionBackupCleanup"
    | "recoveryCleanup",
    WorkflowRunSourceAuthorizationProfile
  >
> = Object.freeze({
  releaseContainment: Object.freeze({
    expectedSourceWorkflowName: "Release Kin Resolve beta candidate",
    expectedSourceWorkflowPath: ".github/workflows/vercel-release.yml",
    allowedSourceEvents: workflowRunDispatchEvents,
    allowedSourceConclusions: workflowRunFailureConclusions,
    requiredHeadBranch: "main",
    displayTitleTemplates: Object.freeze([
      Object.freeze({
        template: "Kin Resolve beta release run {run_id} attempt {run_attempt}"
      })
    ])
  }),
  publicDemoSafety: Object.freeze({
    expectedSourceWorkflowName: "Release Kin Resolve public demo",
    expectedSourceWorkflowPath: ".github/workflows/public-demo-release.yml",
    allowedSourceEvents: workflowRunDispatchEvents,
    allowedSourceConclusions: workflowRunFailureConclusions,
    requiredHeadBranch: "main",
    displayTitleTemplates: Object.freeze([
      Object.freeze({
        template: "Public demo {action} {head_sha} run {run_id} attempt {run_attempt}",
        captures: Object.freeze({
          action: Object.freeze(["release", "rollback", "contain"])
        })
      })
    ])
  }),
  holdingSafety: Object.freeze({
    expectedSourceWorkflowName: "Deploy Kin Resolve static holding page",
    expectedSourceWorkflowPath: ".github/workflows/vercel-holding.yml",
    allowedSourceEvents: workflowRunDispatchEvents,
    allowedSourceConclusions: workflowRunFailureConclusions,
    requiredHeadBranch: "main",
    displayTitleTemplates: Object.freeze([
      Object.freeze({
        template: "Kin Resolve static holding beta-staging run {run_id} attempt {run_attempt}",
        outputs: Object.freeze({
          target: "beta-staging",
          safety_environment: "beta-staging-containment"
        })
      }),
      Object.freeze({
        template: "Kin Resolve static holding production run {run_id} attempt {run_attempt}",
        outputs: Object.freeze({
          target: "production",
          safety_environment: "production-containment"
        })
      }),
      Object.freeze({
        template: "Kin Resolve static holding public-demo run {run_id} attempt {run_attempt}",
        outputs: Object.freeze({
          target: "public-demo",
          safety_environment: "demo-containment"
        })
      })
    ])
  }),
  productionBackupCleanup: Object.freeze({
    expectedSourceWorkflowPath: ".github/workflows/production-backup.yml",
    requiresExpectedSourceWorkflowId: true,
    allowedSourceEvents: workflowRunDispatchEvents,
    allowedSourceConclusions: workflowRunFailureConclusions,
    requiredHeadBranch: "main"
  }),
  recoveryCleanup: Object.freeze({
    expectedSourceWorkflowPath: ".github/workflows/recovery-evidence.yml",
    requiresExpectedSourceWorkflowId: true,
    allowedSourceEvents: workflowRunDispatchEvents,
    allowedSourceConclusions: workflowRunFailureConclusions,
    requiredHeadBranch: "main"
  })
});

const builtinPlaceholderNames = new Set<string>(builtinWorkflowRunPlaceholderNames);
const reservedOutputNames = new Set<string>(reservedWorkflowRunOutputNames);
const placeholderNamePattern = /^[a-z][a-z0-9_]{0,63}$/;
const outputValuePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const tokenNamePattern = /^[a-z][a-z0-9_]{0,63}$/;
const workflowPathPattern = /^\.github\/workflows\/[A-Za-z0-9._-]{1,100}\.ya?ml$/;
const repositoryPattern = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const branchPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/;
const maximumTemplates = 16;
const maximumTemplateLength = 300;
const maximumCaptureValues = 16;
const maximumFixedOutputs = 16;

const requiredConfigKeys = Object.freeze([
  "currentRepository",
  "expectedSourceWorkflowPath",
  "allowedSourceEvents",
  "allowedSourceConclusions",
  "requiredHeadBranch"
] as const);
const optionalConfigKeys = Object.freeze([
  "expectedSourceWorkflowName",
  "expectedSourceWorkflowId",
  "requiresExpectedSourceWorkflowId",
  "displayTitleTemplates"
] as const);

type TemplateSegment =
  | Readonly<{ kind: "literal"; text: string }>
  | Readonly<{ kind: "builtin"; name: "run_id" | "run_attempt" | "head_sha" }>
  | Readonly<{ kind: "capture"; name: string; allowed: readonly string[] }>;

type ParsedDisplayTitleTemplate = Readonly<{
  segments: readonly TemplateSegment[];
  outputs: Readonly<Record<string, string>>;
}>;

type NormalizedConfig = Readonly<{
  currentRepository: string;
  expectedSourceWorkflowPath: string;
  expectedSourceWorkflowName?: string;
  expectedSourceWorkflowId?: string;
  allowedSourceEvents: ReadonlySet<string>;
  allowedSourceConclusions: ReadonlySet<string>;
  requiredHeadBranch: string;
  displayTitleTemplates?: readonly ParsedDisplayTitleTemplate[];
}>;

export function authorizeWorkflowRunSource(
  eventPayload: unknown,
  config: WorkflowRunSourceAuthorizationConfig
): WorkflowRunSourceAuthorization {
  try {
    return Object.freeze({
      authorized: true as const,
      outputs: validateEvent(eventPayload, normalizeConfig(config))
    });
  } catch (error) {
    return Object.freeze({
      authorized: false as const,
      reason: error instanceof Error
        ? error.message
        : "The workflow_run source event could not be authorized."
    });
  }
}

function normalizeConfig(value: unknown): NormalizedConfig {
  const config = object(value, "The authorization config");
  const allowedKeys = new Set<string>([...requiredConfigKeys, ...optionalConfigKeys]);
  const presentKeys = Object.keys(config).filter((key) => config[key] !== undefined);
  if (presentKeys.some((key) => !allowedKeys.has(key))
      || requiredConfigKeys.some((key) => config[key] === undefined)) {
    throw new Error("The authorization config contains unexpected or missing fields.");
  }
  if (config.requiresExpectedSourceWorkflowId !== undefined
      && typeof config.requiresExpectedSourceWorkflowId !== "boolean") {
    throw new Error(
      "The authorization config requiresExpectedSourceWorkflowId flag is malformed."
    );
  }
  if (config.requiresExpectedSourceWorkflowId === true
      && config.expectedSourceWorkflowId === undefined) {
    throw new Error(
      "The authorization config requires an expected source workflow ID but none was provided."
    );
  }
  return Object.freeze({
    currentRepository: repository(config.currentRepository, "The authorization config repository"),
    expectedSourceWorkflowPath: workflowPath(config.expectedSourceWorkflowPath),
    ...(config.expectedSourceWorkflowName === undefined ? {} : {
      expectedSourceWorkflowName: workflowName(config.expectedSourceWorkflowName)
    }),
    ...(config.expectedSourceWorkflowId === undefined ? {} : {
      expectedSourceWorkflowId: strictInteger(
        config.expectedSourceWorkflowId,
        "The authorization config expected source workflow ID",
        20
      )
    }),
    allowedSourceEvents: tokenSet(
      config.allowedSourceEvents,
      "The authorization config allowed source events"
    ),
    allowedSourceConclusions: tokenSet(
      config.allowedSourceConclusions,
      "The authorization config allowed source conclusions"
    ),
    requiredHeadBranch: headBranch(config.requiredHeadBranch),
    ...(config.displayTitleTemplates === undefined ? {} : {
      displayTitleTemplates: parseTemplates(config.displayTitleTemplates)
    })
  });
}

function validateEvent(
  eventPayload: unknown,
  config: NormalizedConfig
): Readonly<Record<string, string>> {
  const event = object(eventPayload, "The workflow_run event payload");
  if (text(event.action, "The event action") !== requiredWorkflowRunEventAction) {
    throw new Error("The event action is not a completed workflow_run.");
  }
  if (nestedRepository(event.repository, "The event repository") !== config.currentRepository) {
    throw new Error("The event repository does not match the current repository.");
  }
  const run = object(event.workflow_run, "The source workflow run");
  if (nestedRepository(run.repository, "The source run repository") !== config.currentRepository) {
    throw new Error("The source run repository does not match the current repository.");
  }
  if (nestedRepository(run.head_repository, "The source head repository")
      !== config.currentRepository) {
    throw new Error("The source head repository does not match the current repository.");
  }
  if (text(run.path, "The source workflow path") !== config.expectedSourceWorkflowPath) {
    throw new Error("The source workflow path is not the expected protected workflow path.");
  }
  const displayTitle = text(run.display_title, "The source display title");
  const workflowRunName = text(run.name, "The source workflow name");
  if (config.expectedSourceWorkflowName !== undefined
      && workflowRunName !== config.expectedSourceWorkflowName
      && workflowRunName !== displayTitle) {
    throw new Error("The source workflow name is not the expected protected workflow name.");
  }
  if (config.expectedSourceWorkflowId !== undefined
      && integer(run.workflow_id, "The source workflow ID", 20)
        !== config.expectedSourceWorkflowId) {
    throw new Error("The source workflow ID does not match the expected source workflow ID.");
  }
  if (!config.allowedSourceEvents.has(text(run.event, "The source event"))) {
    throw new Error("The source event is not an allowed trigger event.");
  }
  if (text(run.head_branch, "The source head branch") !== config.requiredHeadBranch) {
    throw new Error("The source head branch is not the required protected branch.");
  }
  const runId = integer(run.id, "The source run ID", 20);
  const runAttempt = integer(run.run_attempt, "The source run attempt", 10);
  const headSha = sha(run.head_sha, "The source head SHA");
  if (!config.allowedSourceConclusions.has(text(run.conclusion, "The source conclusion"))) {
    throw new Error("The source conclusion is not an allowed conclusion.");
  }
  const extracted = config.displayTitleTemplates === undefined
    ? {}
    : matchDisplayTitle(displayTitle, config.displayTitleTemplates, {
      run_id: runId,
      run_attempt: runAttempt,
      head_sha: headSha
    });
  return Object.freeze({
    ...extracted,
    run_id: runId,
    run_attempt: runAttempt,
    head_sha: headSha
  });
}

function matchDisplayTitle(
  displayTitle: string,
  templates: readonly ParsedDisplayTitleTemplate[],
  builtins: Readonly<Record<"run_id" | "run_attempt" | "head_sha", string>>
): Record<string, string> {
  const matches = templates.flatMap((template) => {
    const match = templateRegExp(template, builtins).exec(displayTitle);
    return match === null ? [] : [{ template, groups: match.groups ?? {} }];
  });
  if (matches.length !== 1) {
    throw new Error("The source display title does not match exactly one expected template.");
  }
  const { template, groups } = matches[0];
  const extracted: Record<string, string> = {};
  for (const segment of template.segments) {
    if (segment.kind !== "capture") continue;
    const captured = groups[segment.name];
    if (typeof captured !== "string" || !segment.allowed.includes(captured)) {
      throw new Error("The source display title capture is malformed.");
    }
    extracted[segment.name] = captured;
  }
  return { ...extracted, ...template.outputs };
}

function templateRegExp(
  template: ParsedDisplayTitleTemplate,
  builtins: Readonly<Record<"run_id" | "run_attempt" | "head_sha", string>>
): RegExp {
  const pattern = template.segments.map((segment) => {
    if (segment.kind === "literal") return escapeRegExp(segment.text);
    if (segment.kind === "builtin") return escapeRegExp(builtins[segment.name]);
    return `(?<${segment.name}>${segment.allowed.map(escapeRegExp).join("|")})`;
  }).join("");
  return new RegExp(`^${pattern}$`);
}

function parseTemplates(value: unknown): readonly ParsedDisplayTitleTemplate[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximumTemplates) {
    throw new Error("The authorization config display title templates are malformed.");
  }
  return Object.freeze(value.map(parseTemplateEntry));
}

function parseTemplateEntry(value: unknown): ParsedDisplayTitleTemplate {
  const entry = object(value, "A display title template");
  if (Object.keys(entry).some((key) => !["template", "captures", "outputs"].includes(key))) {
    throw new Error("A display title template contains unexpected fields.");
  }
  const template = text(entry.template, "A display title template");
  if (template.length > maximumTemplateLength) {
    throw new Error("A display title template is malformed.");
  }
  const placeholders = parsePlaceholderSegments(template);
  const captureNames = placeholders.flatMap((segment) =>
    segment.kind === "placeholder" && !builtinPlaceholderNames.has(segment.name)
      ? [segment.name]
      : []
  );
  if (new Set(captureNames).size !== captureNames.length) {
    throw new Error("A display title template capture is duplicated.");
  }
  if (captureNames.some((name) => reservedOutputNames.has(name))) {
    throw new Error("A display title template capture shadows a reserved output name.");
  }
  const captures = parseCaptures(entry.captures, captureNames);
  const outputs = parseFixedOutputs(entry.outputs, captureNames);
  const segments = placeholders.map((segment): TemplateSegment => {
    if (segment.kind === "literal") return segment;
    if (segment.name === "run_id" || segment.name === "run_attempt"
        || segment.name === "head_sha") {
      return Object.freeze({ kind: "builtin" as const, name: segment.name });
    }
    return Object.freeze({
      kind: "capture" as const,
      name: segment.name,
      allowed: captures[segment.name]
    });
  });
  return Object.freeze({ segments: Object.freeze(segments), outputs });
}

type PlaceholderSegment =
  | Readonly<{ kind: "literal"; text: string }>
  | Readonly<{ kind: "placeholder"; name: string }>;

function parsePlaceholderSegments(template: string): readonly PlaceholderSegment[] {
  const segments: PlaceholderSegment[] = [];
  let literal = "";
  let index = 0;
  while (index < template.length) {
    const character = template[index];
    if (character === "}") throw new Error("A display title template placeholder is malformed.");
    if (character !== "{") {
      literal += character;
      index += 1;
      continue;
    }
    const end = template.indexOf("}", index + 1);
    const name = end === -1 ? "" : template.slice(index + 1, end);
    if (!placeholderNamePattern.test(name)) {
      throw new Error("A display title template placeholder is malformed.");
    }
    if (literal !== "") {
      segments.push(Object.freeze({ kind: "literal" as const, text: literal }));
      literal = "";
    }
    segments.push(Object.freeze({ kind: "placeholder" as const, name }));
    index = end + 1;
  }
  if (literal !== "") segments.push(Object.freeze({ kind: "literal" as const, text: literal }));
  return Object.freeze(segments);
}

function parseCaptures(
  value: unknown,
  captureNames: readonly string[]
): Readonly<Record<string, readonly string[]>> {
  if (value === undefined) {
    if (captureNames.length > 0) {
      throw new Error("A display title template capture is missing its allowed values.");
    }
    return Object.freeze({});
  }
  const captures = object(value, "A display title template capture map");
  const keys = Object.keys(captures);
  if (keys.length !== captureNames.length
      || keys.some((key) => !captureNames.includes(key))) {
    throw new Error("A display title template capture map does not match the template.");
  }
  const parsed: Record<string, readonly string[]> = {};
  for (const key of keys) {
    const allowed = captures[key];
    if (!Array.isArray(allowed) || allowed.length < 1 || allowed.length > maximumCaptureValues
        || new Set(allowed).size !== allowed.length
        || !allowed.every((entry) =>
          typeof entry === "string" && outputValuePattern.test(entry))) {
      throw new Error("A display title template capture is malformed.");
    }
    parsed[key] = Object.freeze([...allowed]) as readonly string[];
  }
  return Object.freeze(parsed);
}

function parseFixedOutputs(
  value: unknown,
  captureNames: readonly string[]
): Readonly<Record<string, string>> {
  if (value === undefined) return Object.freeze({});
  const outputs = object(value, "A display title template output map");
  const keys = Object.keys(outputs);
  if (keys.length > maximumFixedOutputs) {
    throw new Error("A display title template output map is malformed.");
  }
  const parsed: Record<string, string> = {};
  for (const key of keys) {
    const entry = outputs[key];
    if (!placeholderNamePattern.test(key)
        || reservedOutputNames.has(key)
        || captureNames.includes(key)
        || typeof entry !== "string"
        || !outputValuePattern.test(entry)) {
      throw new Error("A display title template output is malformed.");
    }
    parsed[key] = entry;
  }
  return Object.freeze(parsed);
}

function tokenSet(value: unknown, label: string): ReadonlySet<string> {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8
      || new Set(value).size !== value.length
      || !value.every((entry) => typeof entry === "string" && tokenNamePattern.test(entry))) {
    throw new Error(`${label} are malformed.`);
  }
  return new Set(value as string[]);
}

function workflowPath(value: unknown): string {
  const normalized = text(value, "The authorization config expected source workflow path");
  if (!workflowPathPattern.test(normalized)) {
    throw new Error("The authorization config expected source workflow path is malformed.");
  }
  return normalized;
}

function workflowName(value: unknown): string {
  const normalized = text(value, "The authorization config expected source workflow name");
  if (normalized.length > 200 || normalized !== normalized.trim()) {
    throw new Error("The authorization config expected source workflow name is malformed.");
  }
  return normalized;
}

function headBranch(value: unknown): string {
  const normalized = text(value, "The authorization config required head branch");
  if (!branchPattern.test(normalized)) {
    throw new Error("The authorization config required head branch is malformed.");
  }
  return normalized;
}

function nestedRepository(value: unknown, label: string): string {
  return repository(object(value, label).full_name, `${label} name`);
}

function repository(value: unknown, label: string): string {
  const normalized = text(value, label);
  if (!repositoryPattern.test(normalized)) throw new Error(`${label} is malformed.`);
  return normalized;
}

function sha(value: unknown, label: string): string {
  const normalized = text(value, label);
  if (!/^[a-f0-9]{40}$/.test(normalized)) throw new Error(`${label} is malformed.`);
  return normalized;
}

function integer(value: unknown, label: string, maximumDigits: number): string {
  const normalized = typeof value === "number" && Number.isSafeInteger(value)
    ? String(value)
    : value;
  if (typeof normalized !== "string"
      || !new RegExp(`^[1-9][0-9]{0,${maximumDigits - 1}}$`).test(normalized)) {
    throw new Error(`${label} is malformed.`);
  }
  return normalized;
}

function strictInteger(value: unknown, label: string, maximumDigits: number): string {
  if (typeof value !== "string"
      || !new RegExp(`^[1-9][0-9]{0,${maximumDigits - 1}}$`).test(value)) {
    throw new Error(`${label} is malformed.`);
  }
  return value;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is malformed.`);
  }
  return value;
}

function object(value: unknown, label: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} is malformed.`);
  }
  return value as JsonObject;
}

> Status: Implemented in source · Last updated: 2026-07-14

# Private Guided Research Loop

## Objective

Turn a research case into a calm, private loop that helps one person decide what to do next, records what happened, and remembers why a path was weakened or ruled out.

The first production slice must let a user complete this cycle without an AI provider:

1. See one next assignment and why it matters.
2. Start the assignment or record that it was already tried.
3. Record a structured outcome and a useful result note.
4. Explicitly support, weaken, or rule out a hypothesis, with a reason.
5. Receive a different next assignment that does not repeat completed work.

## Product promise

- Private by default: the guide runs deterministically in the application and sends no family data to an external model.
- One useful step: it presents one assignment, not a crowd of answers or a chat feed.
- Human decisions stay human: the guide never automatically rejects a hypothesis or converts a failed search into proof of absence.
- Durable memory: refreshes, restarts, and future guide runs retain task results, decision reasons, and stable assignment fingerprints.
- Clear authority: only roles with `cases:write` can accept assignments, record outcomes, or change hypotheses.

## Primary journey

### 1. Orient

The case page leads with the research question and a featured **Private research guide** panel. It explains:

> Kin Resolve reviews only this case and suggests one useful next step. Nothing is posted to a group or sent to an AI provider.

The panel shows progress as plain counts: evidence collected, assignments completed, and paths ruled out.

### 2. Choose the next assignment

The guide behaves in this order:

1. Short-circuit a paused or resolved case before considering its tasks.
2. Resume an in-progress assignment.
3. Start the highest-priority existing to-do assignment.
4. If no hypothesis exists, ask the user to write one testable explanation.
5. If all hypotheses are rejected, ask for a new hypothesis rather than inventing one.
6. Otherwise propose one deterministic assignment targeting an open, weakened, or supported hypothesis.
7. Suppress work already represented by a completed guide, manual, or legacy task.

Every generated assignment has a stable, server-owned guide key, guidance, linked hypothesis, and case-scoped context references.

### 3. Record what happened

Completing an assignment requires:

- one outcome: `found`, `not_found`, `inconclusive`, `blocked`, or `already_tried`;
- a nonempty result note;
- for `not_found` and `already_tried`, structured search scope plus a note that says where and how the search was performed.

The completion form may also include an explicit hypothesis decision. The task completion and hypothesis decision are saved atomically.

### 4. Decide what the result means

The user may leave hypotheses unchanged or mark one `supported`, `weakened`, or `rejected`. Every status transition requires a reason and appends an attributed decision record. The UI calls rejected hypotheses **Ruled out manually** and makes this warning explicit:

> A missing record is not proof that a hypothesis is false.

The application never infers or applies a hypothesis decision. A correction appends a new decision; it never rewrites the earlier reason.

### 5. Continue without repetition

After saving, the panel recomputes from persisted case state. Completed guide keys and equivalent completed work fingerprints are excluded. The next assignment either targets another unresolved hypothesis, uses a genuinely different deterministic target, or explains that a specific manual search or new hypothesis is needed.

## Scope

### In scope

- Deterministic, case-scoped guide engine.
- Stable guide assignment fingerprints and idempotent acceptance.
- Task priority, origin, guidance, immutable outcome history, structured search scope, completion timestamp, target hypothesis, work fingerprint, and typed context references.
- Append-only, attributed hypothesis decision history.
- Atomic assignment-outcome plus optional hypothesis-decision mutation.
- Add and update hypothesis APIs.
- Direct route-level `cases:write` checks for every touched case mutation.
- Case-page guide, outcome workflow, hypothesis controls, research memory, and responsive styling.
- Dashboard entry card showing the most useful case step.
- Search parity for task outcome notes/guidance and hypothesis decision reasons.
- Migration history and release-upgrade coverage.

### Explicitly out of scope

- Crowd, community, or shared-answer features.
- Chat UI, autonomous browsing, or automatic record searches.
- Provider-generated assignments or sending case data to an AI provider.
- Automatic evidence creation or hypothesis decisions.
- A second research-session or event-table subsystem; bounded outcome/decision histories live with their owning task or hypothesis.
- Exhaustive Genealogical Proof Standard claims.
- Public-site publication of private results or decision notes.

## Domain contract

Extract named case child types in `lib/models.ts`.

### Research reference

```ts
type ResearchReference = {
  type: "case" | "hypothesis" | "evidence" | "task";
  id: string;
};
```

Guide-generated references are server-owned and always case-scoped. The server resolves every reference against the loaded case before persistence. The first slice does not claim source/person/DNA grounding and does not accept arbitrary client references.

### Research hypothesis

Add `decisions: ResearchHypothesisDecision[]` and `updatedAt: string`.

```ts
type ResearchHypothesisDecision = {
  id: string;
  requestId: string;
  fromStatus: ResearchHypothesis["status"];
  toStatus: ResearchHypothesis["status"];
  statement: string;
  reason: string;
  contextRefs: ResearchReference[];
  actorId: string;
  actorName: string;
  createdAt: string;
};
```

Invariant: a new status transition requires a nonempty reason and appends a record containing the exact statement that was decided. A legacy non-open hypothesis with no decision record is rendered as “Reason was not recorded” and is excluded from the grounded rule-out count. Returning to `open` or correcting a decision also appends a record.

### Research task

Add:

- `origin: "manual" | "guide"`
- `priority: "high" | "normal" | "low"`
- `guideKey?: string`
- `workFingerprint: string`
- `guidance: string`
- `targetHypothesisId?: string`
- `contextRefs: ResearchReference[]`
- `outcomes: ResearchTaskOutcome[]`
- `createdAt: string`
- `completedAt?: string`
- `updatedAt: string`

```ts
type ResearchTaskOutcome = {
  id: string;
  requestId: string;
  type: "found" | "not_found" | "inconclusive" | "blocked" | "already_tried";
  note: string;
  searchScope?: {
    repository: string;
    collection?: string;
    place?: string;
    dateRange?: string;
    query?: string;
  };
  actorId: string;
  actorName: string;
  createdAt: string;
  correctsOutcomeId?: string;
};
```

Invariants:

- The new application only completes a task by appending a nonempty outcome record; legacy `done` tasks with no outcome remain representable and are labeled “Result was not recorded.”
- Only a guide task may have a guide key.
- A guide key is unique within an archive and case.
- Completed guide tasks cannot be reopened; a follow-up is a new assignment. Corrections append an outcome record and preserve the original.
- `requestId` makes an identical retry idempotent; `expectedUpdatedAt` prevents stale writes.
- IDs, archive ownership, and case membership cannot be changed through PATCH.

### Guide plan

`buildResearchGuide(researchCase)` is a pure function returning:

- phase: `resume | ready | needs_hypothesis | paused | resolved | exhausted`;
- one current or proposed assignment;
- a short reason for that choice;
- progress counts;
- completed-result memory;
- explicit ruled-out memory.

It performs no I/O, reads no environment variables, and never imports provider code. Snapshot normalization validates that targets and references belong to this case before the engine sees them.

## Deterministic rules

Candidate rules use a stable priority tuple and deterministic tie-break:

1. `paused` and `resolved` case states short-circuit all task rules.
2. Active `doing` task.
3. Existing `todo` task by priority (`high`, `normal`, `low`) then persisted order.
4. Define a testable hypothesis if none exists.
5. Review the lowest-confidence case evidence, without claiming that it supports a particular hypothesis.
6. Find one explicitly scoped first record search for an unresolved hypothesis when the case has no evidence.
7. Compare a named case-evidence item with an open or weakened hypothesis; the assignment asks the user to determine the relationship rather than asserting one.
8. Seek independent corroboration for a supported hypothesis.

Stable generated keys use:

```text
guide:<templateRevision>:<caseId>:<ruleId>:<targetId>:<secondaryTargetOrVariant>
```

Keys include every deterministic secondary target, such as an evidence ID or record-search variant. Each task also receives a normalized work fingerprint; current/completed manual and legacy tasks suppress equivalent generated work even when they have no guide key. A broad first-search suggestion is offered only once; after `not_found`, the guide shows the recorded scope and asks the user to add a different specific search rather than minting an indistinguishable assignment. A negative result never rejects a hypothesis or claims a broader absence.

## Persistence and migration

Add `db/migrations/005_guided_research_loop.sql`. Do not modify migrations 001–004.

The migration:

- adds JSON decision history to hypotheses and JSON outcome history plus guide fields to tasks;
- leaves legacy histories empty and legacy decision/completion timestamps null rather than fabricating events;
- backfills only deterministic task work fingerprints;
- adds compatibility-safe checks for JSON array shape, origins, priorities, and guide-key ownership, but deliberately defers “done requires outcome” and “decision requires reason” database checks until the rollback window closes;
- adds a same-case composite foreign key for `target_hypothesis_id` and validates polymorphic context references in application code;
- adds a partial unique index on `(archive_id, case_id, guide_key)`;
- adds an index supporting next-assignment selection;
- uses additive nullable/defaulted fields so prior writers can still insert rows during the rollback window.

Update `db/migrations/checksums.json`, exact migration catalogs, and the v0.17.4 release-upgrade tests. Fresh and upgraded schemas must match.

## Store operations

Extend current targeted row writers; preserve the archive-row transaction lock.

- `readResearchCase(caseId, options)` performs a case-scoped read.
- `addCaseHypothesis(caseId, input, options)` creates an open hypothesis.
- `updateCaseHypothesis(caseId, hypothesisId, input, options)` checks `expectedUpdatedAt`, appends an attributed decision, and treats a repeated `requestId` as an idempotent success.
- `acceptGuideAssignment(caseId, guideKey, options)` recomputes the guide server-side, accepts no client-authored task metadata, and returns the existing task if the same key was already accepted.
- `recordCaseTaskOutcome(caseId, taskId, input, options)` checks expected versions, appends an attributed outcome, and optionally appends one case-owned hypothesis decision in the same transaction.

`replaceCaseChildren`, snapshot normalization, seed data, mappers, and row writers preserve every new field. Old snapshots normalize empty histories and fingerprints before inserts. Cross-case targets or references fail closed. A prior-release writer compatibility rehearsal proves schema 005 accepts old writes, while the deployment runbook still prohibits rolling the application back after guided history has been created because the old bulk writer would erase unknown columns.

## API contract

All payloads use Zod with explicit length limits.

- `POST /api/cases/[id]/guide/assignments`
  - input: `{ guideKey }`
  - server recomputes the plan and owns title/guidance/references
  - stale key: `409`
- `POST /api/cases/[id]/tasks/[taskId]/outcome`
  - input: `requestId`, `expectedTaskUpdatedAt`, outcome, note, structured search scope, and an optional explicit hypothesis decision with `expectedHypothesisUpdatedAt`
  - saves task and decision atomically; stale versions return `409`; identical retries are no-ops
- `POST /api/cases/[id]/hypotheses`
  - input: statement and optional confidence
- `PATCH /api/cases/[id]/hypotheses/[hypothesisId]`
  - input: statement/confidence or an attributed status transition with `requestId`, reason, and `expectedUpdatedAt`
- Existing task POST/PATCH routes gain Zod validation, guide fields remain server-owned, and direct permission checks are added.

Authorization behavior:

- no session: `401`;
- membership without `cases:write`: `403`;
- missing case/task/hypothesis: `404`;
- invalid or stale guide key: `409`;
- malformed payload or violated decision invariant: `400`.

Every store call receives the session-derived archive ID.

## UI composition

### Case page

Replace the split static hypothesis/task panels with:

- `components/case-research-guide.tsx`: owns local case state and orchestrates the loop;
- `components/research-step-card.tsx`: renders the one current/proposed assignment;
- `components/research-outcome-form.tsx`: accessible structured outcome and optional hypothesis decision;
- `components/hypothesis-workspace.tsx`: add and explicitly update hypotheses.

Page order:

1. Research question and case status.
2. Featured private guide plus current assignment.
3. Working hypotheses.
4. Remembered results and ruled-out paths.
5. Evidence.

The guide uses headings, fieldsets, legends, radios, labels, live status messages, and programmatic focus after state transitions. Every Done action, including a legacy manual task, opens the outcome form. Corrections append history. On a `409`, the component preserves the unsaved note, refreshes the current plan, announces the conflict, and focuses the conflict message. At narrow widths it becomes a single column and all controls remain at least 44px on coarse pointers.

The server passes `canWriteCases` from the session role. Viewers and contributors see the assignment and memory read-only with “An editor can update this case”; mutation controls are not rendered.

### Dashboard

Replace the generic AI Analyst promo card with **Your next research step**. It selects the first active/planning case with an actionable guide state and links directly to that case. Keep `/app/ai` as a separate advanced/experimental surface.

## Dependency graph

```text
migration + domain types
  -> mappers + row writers + snapshot normalization
    -> pure guide engine
      -> scoped store mutations
        -> secured APIs
          -> case UI + dashboard entry
            -> browser and release verification
```

## Test-first execution

### RED checkpoint

Commit failing tests before implementation:

- `tests/research-guide.test.ts`
  - deterministic choice and stable keys;
  - one assignment only;
  - resume before generate;
  - priority ordering;
  - guide-key and manual/legacy work-fingerprint suppression;
  - no automatic rule-out from `not_found`;
  - explicit ruled-out memory requires an attributed decision while legacy unknown decisions remain uncounted;
  - paused/resolved/no-hypothesis states.
- Route tests
  - anonymous/viewer/editor matrix;
  - Zod bounds;
  - forged guide metadata ignored;
  - stale keys return `409`;
  - archive ID comes from the session.
- Database tests
  - migration preserves legacy unknown state without fabricated history;
  - outcome and append-only decision histories round-trip;
  - outcome plus decision is atomic;
  - guide acceptance is idempotent;
  - unrelated rows retain their `xmin`;
  - snapshots retain guided fields.
- Compatibility/concurrency tests
  - v0.17.4 writers can still write against expanded schema 005 before guided data exists;
  - stale expected versions return `409` without overwriting state;
  - identical `requestId` retries return the original result;
  - completed guide tasks cannot reopen and corrections append rather than overwrite.
- Search tests
  - outcome notes/guidance/decision reasons have SQL and in-memory parity.

The RED run must fail because the new module/types/routes/schema do not exist, not because the test harness is broken.

### GREEN checkpoint

Implement the smallest complete path that makes the contract pass. Commit implementation separately from the RED tests.

### Refactor checkpoint

After green, remove duplication, keep UI components bounded, and rerun the complete suite before a cleanup commit.

## Verification gates

- `npm test`
- `npm run test:db`
- `npm run test:release-upgrade`
- `npm run migrations:verify`
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- browser smoke at desktop and mobile widths:
  - accept/start assignment;
  - record `not_found` without changing a hypothesis;
  - explicitly weaken or reject with a reason;
  - refresh and verify memory;
  - verify a different next step;
  - keyboard navigation and focus/status behavior.

## Rollback and rollout safety

- Migration 005 is an expand-only schema change and remains compatible with pre-feature inserts/updates during the initial rollback window.
- Once any guided outcome or decision history exists, rolling back to the old application is **not** data-safe because its bulk case writer does not preserve unknown fields. Use a forward fix or disable the feature in the new binary; do not deploy the old binary over guided data.
- Ship the guide behind a server-side feature flag so the UI and mutations can be disabled without changing binaries or deleting data.
- Do not down-migrate production data. Never delete or rewrite user outcome/decision history during recovery.
- A later contract migration may add strict database invariants only after the rollback window closes and all writers dual-write the new fields.

## Exit criteria

- A user can finish the full plan → work → result → decision → next-plan loop after a page refresh.
- The guide does not repeat equivalent completed or already-tried work from generated, manual, or legacy tasks.
- A failed search never changes a hypothesis without an explicit decision.
- A viewer cannot mutate any touched case endpoint and sees no mutation controls.
- No guide path calls an external provider.
- Fresh-install and v0.17.4 upgrade tests pass with the same final schema.
- Desktop and mobile browser smoke tests pass.

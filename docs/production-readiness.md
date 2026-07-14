# Kin Resolve production-readiness plan

_Roadmap from the current codebase to a launchable hosted beta + polished OSS 1.0._
_Companion to [`docs/auth.md`](auth.md) (identity design) and the locked business
direction (AGPL OSS + hosted service, GPS-AI wedge, DNA hosted with compliance)._

**Legend for ownership:** 🧑 = **you** (Eric — accounts, money, legal, decisions) ·
🤖 = **engineering** (code/tests/PRs) · 🤝 = **both** (you provision, I wire it up).

---

## 1. Where we are

Phase 1 (persistence + read paths + identity) is essentially complete:

| Landed | PR |
| --- | --- |
| AGPL relicense + CONTRIBUTING + truth-in-README | #11 |
| Full-archive GEDCOM 5.5.1 export (anti-lock-in) | #12 |
| Versioned migration framework (`db:migrate`) | #13 |
| Row-level persistence (killed whole-archive rewrite) | #14 |
| Store mapper extraction | #15 |
| Scoped SQL search — people + public pages | #16 |
| Scoped SQL search — sources | #17 |
| Scoped SQL search — cases + evidence queue | #18 |
| Scoped SQL search — DNA triage | #19 |
| **Account-based auth + memberships (better-auth)** | **#20 (merged)** |
| **Reviewed next-slice execution blueprint** | **#21 (merged)** |
| **Marketing foundation and public-site preview** | **#22 and #23 (merged)** |
| **Immutable migration repair + released-schema rehearsal** | **#24 (draft review)** |

The app is a working single-archive vertical slice with real accounts. It is **not
yet** multi-tenant, billable, observable, compliant, or backed by the AI
differentiator. This document is the path to those.

Active engineering workstream 1A adds complete product pull-request CI, makes migration
history immutable, rehearses the v0.17.4 schema upgrade, and replaces legacy release
assumptions with explicit version, project, environment, and deployment checks. It does
not promote a release candidate or migrate production; those remain workstream 1B.

---

## 2. Definition of "production-ready"

Two distinct release gates — don't conflate them:

- **OSS 1.0 (self-hosted)** — a self-hoster can run Kin Resolve from `docker compose`
  with no Vercel/Supabase dependency, create an account, import within documented and
  tested deployment limits, use every supported feature, export their data, and trust
  that living-person privacy holds.
- **Hosted beta (`kinresolve.com`)** — invited participants can use the hosted product
  under explicit beta terms before open signup or billing is introduced. A later
  public release may add self-service signup, collaboration, and paid plans once those
  surfaces are implemented and operated safely.

The remaining slices below are tagged with which gate they serve. Some serve both.

---

## 3. 🧑 Your action items (start these now — they have lead times)

These are **yours** and several have long lead times, so kick them off in parallel
with engineering. Nothing here is code.

### A. Domain + brand (do first — everything public keys off it)
1. **Complete formal brand clearance.** Kin Resolve is the working public name and
   repository name. Domain registration does not replace a professional trademark
   review; complete that review before a broad launch or permanent print investment.
2. **Domain registered.** `kinresolve.com` was registered through Cloudflare on
   2026-07-13. Keep registrar recovery access under founder control.
3. **Marketing preview and beta contact route approved.** The intended split is
   `kinresolve.com` for marketing and `app.kinresolve.com` for the hosted product.
   `beta@kinresolve.com` routing is active and delivery-tested; preserve its mail DNS
   records during the separate web-domain cutover and confirm rollback ownership first.

### B. Accounts to create (I'll wire each in once they exist) 🤝
4. **Vercel** production project + **Supabase** production database (or your chosen
   Postgres host) — the hosted runtime. You already have a Vercel project. Before the
   next stable release, add the canonical HTTPS `APP_BASE_URL` and confirm every
   production value listed in the README; release validation intentionally fails until
   the contract is complete.
5. **Stripe** account (for billing). Business entity helps here — see item 9.
6. **An AI provider account** (OpenAI-compatible) for the bundled hosted AI tier,
   plus a spend cap. BYO-key covers OSS; this is for paid hosted users.
7. **Transactional email** (Resend, Postmark, or SES) — needed for invitations,
   password reset, and email verification. Get the sending domain verified (SPF/DKIM).
8. **Error tracking** (Sentry free tier) — I'll wire the SDK once the DSN exists.

### C. Legal + compliance (longest lead time — start immediately) 🧑
9. **Form a business entity** (LLC is typical) before taking payments or holding
   others' family/DNA data. Talk to an accountant about the hosted-service revenue.
10. **Engage privacy counsel.** You chose to host DNA-derived data, which pulls in
    GDPR Art. 9 (genetic = special category, explicit consent) and the US state
    genetic-privacy patchwork (IL/CA/UT/MT/TN/TX/VA…). This is a real budget line, not
    an engineering task. Counsel produces: privacy policy, ToS, DPA, consent language,
    and a data-retention/deletion policy. I build the machinery to honor them (§5.D).
11. **Cyber/liability insurance** quote once the entity exists — hosting family and
    DNA data is a breach-liability surface.

### D. Partnerships (apply early — approval is slow) 🧑
12. **FamilySearch API / partner access** — the agentic record-search feature (§5.E)
    depends on it and approval takes months. Apply as soon as the entity exists.
13. Optional: FindAGrave / other record-source terms — evaluate later.

### E. Decisions only you can make 🧑
14. **Pricing** — the OSS-SaaS research suggested €5–15/mo tiers; you set the numbers
    and the free/paid split (default from the plan: OSS fully-featured single-archive;
    paid = hosting + collaboration + bundled AI + DNA-compliance infra + backups/SLA;
    enterprise = SSO + audit + white-label).
15. **Beta cohort** — who gets in first. The plan recommends the GPS-minded community
    (genealogy societies, APG/BCG orbit, r/Genealogy) since they confer trust.

---

## 4. 🤖 Finish the identity core (unblocks everything multi-user)

PR #20 landed accounts + memberships. The remaining auth phases from
[`docs/auth.md`](auth.md), in order:

- **4.1 Route-level RBAC sweep** 🤖 — `assertPermission` on every mutating route with
  the session-derived role (only the AI route enforces today). Small, high-value,
  do next after #20.
- **4.2 Invitations + multi-member archives** 🤝 — invite flow (needs the email
  provider, item 7), member-management UI, per-member roles. This is the first *paid*
  collaboration feature.
- **4.3 Email verification + password reset** 🤝 — deferred from #20 to avoid a mail
  dependency in the core; turn on once email (item 7) exists.
- **4.4 Tenant resolution** 🤖 — resolve the archive from the authenticated principal
  (membership) instead of `KINSLEUTH_ARCHIVE_ID`; add Postgres RLS policies as
  defense-in-depth. This is the true multi-archive unlock.
- **4.5 Durable rate limiting** 🤖 — move better-auth's per-instance limiter to
  database/Redis storage so it holds across serverless instances.

---

## 5. 🤖 Platform hardening (the operability gap)

### A. Object storage / self-host portability (**OSS 1.0 blocker**)
Generic source-file uploads still write to local disk, and large-GEDCOM staging is
hard-wired to Vercel Blob — so the self-hosted Docker path can't handle big imports or
file attachments. Build a storage adapter interface: S3-compatible (MinIO) for
self-host, Vercel Blob/S3 for hosted, tenant-namespaced keys. This wires the already
provisioned-but-dead `S3_*` config and is the last thing making "self-host it" real.

### B. Observability + support surface (**hosted blocker**)
Structured logging, Sentry (item 8), basic metrics, and an admin/support view.
The OSS-SaaS research flagged support cost as the margin-killer for solo operators —
you can't run a paid service blind.

### C. Real backups + restore UX
Row-level persistence made pre-import snapshots real; add scheduled per-archive
backups and a user-facing restore path for the hosted tier.

### D. GDPR/DSAR + DNA compliance machinery (**hosted blocker, gated on §3.C counsel**)
Consent capture, data export (the GEDCOM exporter is a head start), account deletion,
right-to-erasure, breach process. **DNA-specific:** explicit-consent flows (Art. 9),
encryption at rest for DNA-derived data, hard-deletion guarantees. I build to the
policy counsel writes.

### E. Component + UX debt
Decompose the 500–750-line workspace components, add a shared client data layer, and
wire the remaining dead UI (person-profile tabs, settings persistence). Quality-of-life
before you put it in front of paying strangers.

---

## 6. 🤖 The differentiator — GPS AI research agent

This is the planned Kin Resolve differentiator. Do not market it as a current
capability: the product does not yet enforce the
Genealogical Proof Standard. Architecture principle: **never state what you can't
cite.** Sequenced roughly:

1. **Wire pgvector for real** — embed on write (background job), kNN retrieval to
   replace the 28k-char whole-workspace prompt stuffing.
2. **Citation grounding + abstention** — every model claim must reference a real,
   validated workspace entity; abstain rather than assert unsourced facts.
3. **Redact/pseudonymize living people** before any external provider call (today the
   full private tree ships unredacted).
4. **Conflict + chronology engine** — cross-source contradictions, parent-age/lifespan
   plausibility, duplicate-person detection.
5. **GPS workflow surfaces** — research log, reasonably-exhaustive-search checklist,
   forced conflict resolution, Proved/Probable/Possible confidence, citation templates.
6. **Provider hardening** — timeout/abort, retries, streaming, token budgeting, per-run
   cost logging + per-tenant metering (bundled-AI paid tier).
7. **Agentic record search v1** — tool-calling against FamilySearch (item 12) +
   user-attached documents; DNA shared-match clustering (Leeds method).

Media galleries, interactive pedigree/timeline visualization, and maps are the other
big product-surface items (originally Phase 2) — high user value, schedule against AI.

---

## 7. Domain + public-facing site (your call-out, expanded)

You specifically want to stand up the public site. Here's the concrete shape.

**Recommended domain layout:**
- `kinresolve.com` and `www.kinresolve.com` → **marketing/landing site** (what Kin Resolve
  is, private-beta interest, product status, and OSS repository link). Pricing remains
  absent until it is decided.
- `app.kinresolve.com` → the **product** (the hosted Next.js app; private workspaces +
  each family's public archive).
- Later, per-tenant public archives can live at `app.kinresolve.com/a/<archive>` or, as
  a premium feature, custom domains / subdomains you map with Vercel's domains API.

This split keeps marketing SEO/iteration independent from the app and is the standard
Ghost/Plausible shape.

**The marketing site** is a self-contained static Next app under `site/`, deployed as
a separate project so public copy and design can ship without coupling to the product
runtime or release cadence.

**Your remaining step for the site** 🧑: authorize the Cloudflare web-DNS change after
the production target is verified. The preview and beta mailbox are approved and tested.
**Engineering steps** 🤖: verify the active-intake preview, publish the production
artifact, then wire the approved domain without disturbing mail records.
Pricing is intentionally absent until it is decided. Per-tenant public-archive routing
still depends on tenancy (4.4).

**Note on the existing public archive:** each family archive has a person-level,
privacy-gated preview surface (`/`, `/people`, `/stories`, `/places`). Do not market it
as a privacy-safe per-family site until Gate C adds public-only projections and explicit
fact/source publication. Multi-tenancy (4.4) can turn that into a later product surface.

---

## 8. Suggested sequencing

Roughly three arcs; they overlap, and your §3 items run alongside all of them.

**Arc 1 — Merge & make multi-user real (weeks)**
RBAC sweep (4.1) → object-storage adapter (5.A, OSS 1.0 unblock) →
tenant resolution + RLS (4.4) → invitations + email (4.2/4.3). Ship **OSS 1.0** at the
end of this arc (self-host works end-to-end; no billing needed).

**Arc 2 — Make it operable & sellable (weeks–months)**
Observability (5.B) → backups (5.C) → billing/Stripe + plan tiers (needs §3.B/C) →
GDPR/DSAR + DNA compliance machinery (5.D, gated on counsel) → component/UX debt (5.E).
Private hosted beta opens mid-arc to a small trusted cohort.

**Arc 3 — The differentiator (months, can start in parallel)**
The GPS AI agent (§6) and tree/media visualization. This is what turns "another
webtrees" into the thing the market research says is open. Start pgvector + grounding
early since it's the longest-value item.

**Public launch** = OSS 1.0 announcement + hosted beta on `kinresolve.com`, once Arc 2's
compliance and billing are real and Arc 3 has at least the grounded-citation AND
conflict-detection pieces (enough to demonstrate the GPS wedge).

---

## 9. Immediate next actions

- 🤖 **Engineering:** land workstream 1A's migration and product-CI stack, then start
  the RBAC sweep (4.1) and object-storage adapter (5.A)—the two feature slices blocking
  OSS 1.0.
- 🧑 **You, this week:** authorize the marketing web-DNS cutover after production
  verification, form the entity + contact privacy counsel (§3.C.9–10), and apply for
  FamilySearch API access (§3.D.12). Those items gate later arcs.
- 🤝 **When ready:** create the Stripe, email, Sentry, and AI-provider accounts (§3.B)
  and hand me the keys/DSNs; each unlocks a specific slice above.

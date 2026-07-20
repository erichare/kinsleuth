# Public-demo launch materials

- **Status:** Demo-launch copy and launch-day brief; not authorization to claim the demo is live
- **Updated:** 2026-07-20
- **Operational gates:** [`public-demo-runbook.md`](public-demo-runbook.md)
- **Claims contract:** [`brand-and-domain.md`](brand-and-domain.md)
- **Private-beta companion:** [`private-beta-launch-materials.md`](private-beta-launch-materials.md)

The public demo at `demo.kinresolve.com` going live is the public launch. This package
gives marketing and operations one approved claim set for the marketing flip, the Show HN
post, and the genealogy-community posts. All media must use the fictional Hartwell–Mercer
archive. Nothing here loosens the public claims contract in
[`brand-and-domain.md`](brand-and-domain.md): the hosted private beta stays
invitation-only, and no copy may imply hosted availability. Publish nothing below until
every external gate in [`public-demo-runbook.md`](public-demo-runbook.md) has recorded
evidence.

## Approved demo-live message set

**One-liner (hero call to action):**

> Solve the passenger mystery

**Supporting line (use exactly, including punctuation):**

> No signup · about 2 minutes · every record is fictional.

**Longer form for posts and link descriptions:**

> The Kin Resolve public demo is live at https://demo.kinresolve.com/. Solve the fictional
> Mercer–March passenger mystery in about two minutes—no signup, a disposable workspace
> that expires after 24 hours, and not one real family record anywhere.

**Forbidden phrases.** Never publish these in any channel, headline, reply, or comment:

- “the beta is open,” “join the beta,” “access is rolling out,” or any wording implying
  hosted invitations have started;
- “production-ready,” “battle-tested,” or any other production-readiness claim; and
- any hosted-availability claim: open signup, live hosted accounts, “try the API,” shared
  multi-family hosting, or hosted DNA or hosted external-AI availability.

The demo proves the source product on synthetic data. Say that, and say nothing more.

## Show HN draft

### Title candidates

HN norms apply: concrete, no hype, no exclamation marks, under 80 characters. Choose one:

1. Show HN: Kin Resolve – an open-source genealogy research workspace (AGPL)
2. Show HN: Solve a fictional genealogy records mystery in 2 minutes, no signup
3. Show HN: Kin Resolve – genealogy research cases with evidence and hypotheses

### Body

> Hi HN, I built Kin Resolve, an open-source (AGPL-3.0-only) genealogy research workspace.
>
> The itch: family-tree software stores conclusions, but the actual work of genealogy is
> research. A 1907 passenger declaration says one thing, a 1909 marriage ledger says
> another, and an old family story credits someone else entirely. Most tools make you
> quietly pick a winner and move on. Kin Resolve keeps the question, the evidence, the
> competing hypotheses, and the next task together in a research case, so uncertainty
> stays visible until the evidence earns a conclusion.
>
> The demo: https://demo.kinresolve.com/ drops you into the fictional Hartwell–Mercer
> family archive and asks whether two men named Samuel in the records were the same
> person. It takes about two minutes, needs no signup, and gives you a disposable
> workspace that expires after 24 hours. Every record is invented; no real family data
> appears anywhere, and the demo accepts no uploads.
>
> Stack: Next.js 16, React 19, Postgres with pgvector, Vitest. Self-hosting is a git
> clone plus Docker Compose (Postgres and MinIO included). GEDCOM import has
> preview/apply/rollback, and the whole archive exports back to GEDCOM 5.5.1, so nothing
> gets locked in. Deterministic structural checks run with no AI key at all; connecting an
> OpenAI-compatible provider is optional and stays off by default.
>
> Honest boundaries: the hosted product is an invitation-only private beta—applications
> are open, invitations have not started. DNA triage and external-provider AI exist in
> source but are excluded from the first hosted cohort, because I am not willing to
> operate genetic data or route private research through third-party AI providers before
> the safety and legal gates for those capabilities pass.
>
> What I would most like feedback on is the research-case model: a case is one question
> plus evidence, competing hypotheses with confidence, and next tasks. If you have done
> genealogy—or any other evidence-driven research—does that decomposition match how you
> actually work, or is it too much ceremony?

### Prepared first comment (founder)

Post immediately after submission:

> A few answers to questions I expect:
>
> Why fictional data? Every name, date, place, record, photograph, and DNA value in the
> demo and screenshots belongs to the invented Hartwell–Mercer family. The demo takes no
> uploads and creates no accounts, so there is no way to put real family data into it.
>
> Why AGPL? Genealogy data is about as personal as data gets. Network copyleft keeps any
> hosted derivative honest about its source, and self-hosting stays a first-class path.
>
> What the demo will not do: no accounts, no uploads, no email, no persistence beyond the
> 24-hour disposable workspace. It exists to show the research-case workflow, not to hold
> your archive.
>
> Self-hosting: git clone, docker compose up, one provisioning command for the synthetic
> archive. The README quick start covers it.
>
> Hosted status: invitation-only private beta. Applications are open at
> https://kinresolve.com/beta/; invitations have not started and begin only after the
> launch gates pass.

## Genealogy community variants

### r/Genealogy — puzzle first

**Title:** I built a fictional records mystery — can you solve it?

> Builder disclosure up front: I made this and I am posting my own project.
>
> Kin Resolve is an open-source genealogy research workspace I have been building, and
> its public demo is a short records puzzle: a 1907 passenger declaration, a 1909
> marriage ledger, an independent 1906 letter, and one question—were Samuel Mercer and
> Samuel March the same person? It takes about two minutes, is free, needs no signup, and
> every record is invented, so there is nothing real to protect and no way to get it
> wrong with someone's actual ancestors: https://demo.kinresolve.com/
>
> What I would love from this community: does the way it holds conflicting evidence—the
> question, the sources, and competing hypotheses kept together instead of silently
> picking a winner—match how you actually research?

### r/opensource — short variant

> Kin Resolve is an AGPL-3.0-only genealogy research workspace: GEDCOM import with
> preview/apply/rollback, sources, research cases with competing hypotheses, deterministic
> quality checks with no AI key, and GEDCOM 5.5.1 export. I built it and just opened a
> free, no-signup public demo built entirely on fictional records:
> https://demo.kinresolve.com/ — source at https://github.com/erichare/kinresolve. The
> hosted beta is invitation-only; self-hosting is the unrestricted path.

### r/selfhosted — short variant

> Self-hosted genealogy research workspace (AGPL-3.0-only, I am the developer): Next.js,
> Postgres with pgvector, Docker Compose with bundled Postgres and MinIO. GEDCOM in with
> preview/apply/rollback, GEDCOM 5.5.1 back out, deterministic checks with no external AI
> call, and an optional bring-your-own OpenAI-compatible provider that stays off by
> default. Two-minute fictional-records demo, no signup: https://demo.kinresolve.com/ —
> source: https://github.com/erichare/kinresolve

### Community rules check

- [ ] On launch day, re-read each target community’s current self-promotion rules and
      pinned moderator posts before posting; adjust the disclosure or flair, or skip the
      community entirely if the post cannot comply.

## Tester quotes and usage counter

### Tester-quote capture plan

Quotes come only from the five-tester gate in
[`public-demo-runbook.md`](public-demo-runbook.md):

- During the five-tester gate, capture two or three short quotes about the demo
  experience.
- Each published quote requires the tester’s written consent, stored with the launch
  evidence record.
- Attribution is first name plus researcher type only (for example, “Dana, professional
  genealogist”); no surnames, employers, or contact details.
- Quotes may describe the demo and the research-case workflow only. Reject or trim any
  quote that implies hosted availability, an open beta, or production readiness.

### Usage-counter contract

The marketing site’s solved-mystery counter reads the public stats endpoint:

- `GET https://demo.kinresolve.com/api/public/demo-stats`
- Response body: `{"mysteriesSolved": <number>, "since": <ISO-timestamp>}`
- Response headers: `cache-control: public, s-maxage=60, stale-while-revalidate=300` and
  `access-control-allow-origin: https://kinresolve.com`

The counter renders only the value the endpoint returns. If the endpoint is unreachable
or malformed, hide the counter entirely; never render a fabricated, hardcoded, or
stale-beyond-contract number. The endpoint exposes aggregate counts only and must never
grow visitor-identifying fields.

## Launch-day flip checklist

Work the steps in order; stop at the first failure.

1. [ ] The demo is promoted through **Release Kin Resolve public demo** (action
       `release`) and every external gate in the runbook has recorded evidence.
2. [ ] The repository variable `KINRESOLVE_MARKETING_DEMO_MODE` is set to `live`
       (`gh variable set KINRESOLVE_MARKETING_DEMO_MODE --body live`). The product
       release workflow’s marketing job reads this variable (defaulting to `pending`
       when unset), so without this step a routine product release would silently
       rebuild `kinresolve.com` with the pending homepage copy.
3. [ ] The marketing site is redeployed through the site-deploy workflow with
       `KINRESOLVE_MARKETING_DEMO_MODE=live`.
4. [ ] Production `kinresolve.com` is verified by hand: the hero primary action is
       “Solve the passenger mystery,” the supporting line reads exactly “No signup ·
       about 2 minutes · every record is fictional.”, and the usage counter renders from
       the live stats endpoint.
5. [ ] The Show HN post and prepared first comment are published, then each community
       variant after its rules check passes.
6. [ ] The demo link is added near the top of `README.md`.
7. [ ] Rollback path stands ready: set the repository variable back with
       `gh variable set KINRESOLVE_MARKETING_DEMO_MODE --body pending`, redeploy
       marketing with `KINRESOLVE_MARKETING_DEMO_MODE=pending`, and if the demo itself
       must be unpublished, dispatch the public-demo release workflow’s `contain` action
       per the runbook.

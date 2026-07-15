# Kin Resolve and Ancestry: non-confidential integration overview

This document is a draft for the published Ancestry corporate integrations
contact route. It contains no credentials, customer data, private tree data, or
confidential implementation details. Do not represent API access as approved
until Ancestry confirms that in writing.

## Product

Kin Resolve is a private genealogy research workspace. Researchers bring family
tree data into a private archive, compare new evidence with existing work, review
conflicts, organize research questions, and selectively publish material they
have cleared for public use.

Today Kin Resolve supports user-initiated tree exports. It does not request
Ancestry credentials, automate Ancestry pages, scrape records, or write changes
back to Ancestry.

## Partnership request

We would like to evaluate an authorized, read-only Ancestry integration that
lets a user explicitly authorize one tree and send changes through Kin Resolve's
existing review-before-apply workflow. File-export import will remain available;
the API path would reduce repeated manual exports without silently changing
either system.

The initial product scope is family-tree research only:

- people and stable identifiers;
- typed relationships and facts;
- sources, citations, notes, and permitted media metadata;
- tree selection and incremental inbound changes; and
- disconnect, revocation, and provider-required deletion behavior.

AncestryDNA, hints, messages, stories, credential collection, browser automation,
and writeback are out of scope.

## Requested technical and policy information

We are requesting the current partner documentation and a sandbox covering:

- OAuth authorization code flow with PKCE and redirect registration;
- read-only tree, fact, relationship, source, citation, and permitted-media scopes;
- stable account, tree, and entity identifiers;
- incremental cursors or webhooks and their ordering guarantees;
- rate limits, shared-tree permissions, and living-person rules;
- token revocation, disconnect, retention, and deletion requirements;
- attribution, caching, and record-image rights; and
- whether user-authorized data may be supplied at runtime to an AI research
  assistant when it is excluded from model training and never used across
  customers.

## Privacy and control commitments

Kin Resolve scopes every integration operation to the authenticated user's
private archive. Incoming changes are staged for review, local-only edits are
preserved, conflicts require a decision, and remote deletions never hard-delete
local research. Imported people and files default to private. Third-party record
images are excluded from public publishing and AI context unless Ancestry's
written terms explicitly permit the intended use and the user has the required
rights.

Tokens would be encrypted and stored separately from login accounts. OAuth state
would be one-use, time-limited, and bound to both the user and archive. The direct
API capability would remain disabled until the contract, security review, and
partner approval are complete.

## Proposed pilot

After sandbox approval, we propose a small opt-in pilot using synthetic trees
first, followed by an invited cohort that has explicitly agreed to test the
integration. Operational metrics would record timing, counts, error classes,
conflict rates, and rollback use—not names, facts, filenames, tree contents, or
other genealogical data.

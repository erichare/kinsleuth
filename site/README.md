# Kin Resolve marketing site

This directory is a self-contained static Next.js application for `kinresolve.com`. It has no imports from the product app, database, authentication, workspace storage, or family data. The fictional research challenge keeps its pure canon and browser-only interaction factory in `shared/`; tiny adapters inject each app's own React runtime so the product and marketing builds share one implementation without loading duplicate React instances.

## Local verification

```bash
npm ci
npm run verify
```

`verify` runs ESLint, TypeScript, a portable static export, and checks every exported route, internal link, asset, and required social/search file.

Use `npm run dev` for local development. The production repository also exposes `npm run site:dev` and `npm run site:verify` from the root.

## Deployment

The site is linked to the isolated Vercel project `kinresolve-marketing`; it does not share the product project or release workflow. `kinresolve.com` is live and `www.kinresolve.com` redirects to the apex. `app.kinresolve.com` is not configured yet.

- Pull requests verify the portable static artifact but never receive deployment credentials.
- Preview and production deployments are manual, main-only runs of `.github/workflows/site-deploy.yml`; the workflow defaults to preview mode.
- The workflow uses `VERCEL_TOKEN` and `VERCEL_ORG_ID` secrets plus the `MARKETING_VERCEL_PROJECT_ID` repository variable.
- Cloudflare DNS remains outside the workflow. Marketing DNS is live; the future `app.kinresolve.com` record requires separate owner approval after product candidate, TLS, auth, and rollback checks.

The beta form opens a prepared email to `beta@kinresolve.com` and offers a copy fallback. Cloudflare Email Routing was activated and delivery-tested on 2026-07-13. `betaIntakeReady` in `lib/site.ts` remains the explicit intake kill switch. The marketing site does not store submissions. A native application endpoint is proposed for a later launch slice; it is not live.

## Content boundaries

Current capabilities and roadmap claims follow [`docs/brand-and-domain.md`](../docs/brand-and-domain.md). The centralized interim status is `lib/beta-status.ts`; the homepage, product page, beta page, and footer must render it and the static verifier prevents stale live-beta wording from returning. The proposed cohort contract is [`docs/hosted-beta-contract.md`](../docs/hosted-beta-contract.md). Keep product status labels explicit, use synthetic examples only, and do not present a product-practices page as counsel-approved legal terms.

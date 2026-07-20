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

The site is linked to the isolated Vercel project `kinresolve-marketing`; it does not share the product project. `kinresolve.com` is live and `www.kinresolve.com` redirects to the apex. `app.kinresolve.com` is configured separately and currently serves the verified zero-runtime product holding page, not the Kin Resolve runtime.

- Pull requests verify the portable static artifact but never receive deployment credentials.
- Standalone preview and production deployments are manual, main-only runs of `.github/workflows/site-deploy.yml`; they are hard-bound to prelaunch claims. Hosted-live claims publish only from the product release workflow after its production evidence gates pass.
- The workflow reads `VERCEL_TOKEN` and `VERCEL_ORG_ID` secrets plus the `MARKETING_VERCEL_PROJECT_ID` variable only from its selected `preview` or `production` GitHub environment; these values are not repository-wide.
- Cloudflare DNS remains outside the workflow. Marketing and product DNS are live, while the product hostname stays pinned to the approved holding deployment until the protected runtime release gates pass.

The default beta form remains the verified native `mailto:` fallback. Set
`KINRESOLVE_MARKETING_BETA_APPLICATION_MODE=application` at build time only after
the product deployment has `KINRESOLVE_BETA_APPLICATIONS_ENABLED=true`, a distinct
`KINRESOLVE_BETA_APPLICATION_HMAC_SECRET`, working database grants, and verified
transactional email. Application mode is still a static, no-JavaScript
`application/x-www-form-urlencoded` form; it posts only the fixed fields to
`https://app.kinresolve.com/api/public/beta-applications`. Invalid build-mode values
fail the marketing build. Rebuild with `mailto` to roll back intake without changing
the product deployment.

`KINRESOLVE_MARKETING_RELEASE_MODE` is a separate evidence-bound claim switch. It
defaults to `prelaunch`; its only other accepted values are `application` and
`api-launch`. `application` says the hosted private beta is live for approved
participants while the API remains unavailable. `api-launch` additionally says
API v1 is available only to approved participants for archives they own. The
standalone deployment workflow always sets `prelaunch`; the protected product
release workflow maps its exact release mode into this value and probes the
canonical page after deployment. Any other value fails the build.

`KINRESOLVE_MARKETING_DEMO_MODE` is the public-demo launch flip. It defaults to
`pending`, which renders today's hero call to action and note unchanged; its only
other accepted value is `live`, which switches the hero primary call to action to
"Solve the passenger mystery" and states that the public demo is live while the
hosted workspace remains an invitation-only private beta. CI proves both demo
modes against every release and intake combination, the standalone deployment
workflow exposes the flag as an explicit `demo_mode` input defaulting to
`pending`, and the static verifier fails if live-demo copy appears in a pending
export. Any other value fails the build.

## Content boundaries

Current capabilities and roadmap claims follow [`docs/brand-and-domain.md`](../docs/brand-and-domain.md). The centralized interim status is `lib/beta-status.ts`; the homepage, product page, beta page, and footer must render it and the static verifier prevents stale live-beta wording from returning. The proposed cohort contract is [`docs/hosted-beta-contract.md`](../docs/hosted-beta-contract.md). Keep product status labels explicit, use synthetic examples only, and do not present a product-practices page as counsel-approved legal terms.

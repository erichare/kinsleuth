#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import {
  chromium,
  type APIResponse,
  type Browser,
  type BrowserContext,
  type Page,
  type Response as BrowserResponse
} from "playwright";
import { Pool } from "pg";

import {
  acceptBetaInvitation,
  issueBetaInvitation,
  revokeBetaInvitation,
  setBetaInvitationControl,
  verifyBetaEmail,
  type BetaInvitationServiceOptions
} from "../lib/beta-invitations.ts";
import { isCurrentBetaLegalAcceptance, loadApprovedBetaLegalManifest } from "../lib/beta-legal-manifest.ts";
import { provisionArchive } from "../lib/archive-provisioning.ts";
import {
  resolveIdentityBrowserCanaryConfiguration,
  type IdentityBrowserCanaryConfiguration
} from "./identity-browser-canary-contract.ts";
import {
  assertDisposableDatabasePreflight,
  assertFinalProductMutationBoundary,
  assertInvitationTerminalState,
  createIdentityCanarySecrets,
  identityCanaryOperatorClaim,
  readOwnerUserId,
  seedExpiredInvitation,
  seedKnownPasswordReset,
  seedMembershiplessAccount,
  tokenFromActionUrl,
  type IdentityCanarySecrets,
  type SyntheticCredentials
} from "./identity-browser-canary-state.ts";

type JsonRecord = Record<string, unknown>;

const canonicalActionOrigin = "https://app.kinresolve.com";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const apiTokenPattern = /^kr_beta_[A-Za-z0-9_-]{43}$/;
const invitationUnavailableMessage = "This invitation is invalid, expired, or unavailable. Ask the Kin Resolve beta operator for a new invitation or contact beta@kinresolve.com.";
const verificationUnavailableMessage = "This verification link is invalid, expired, or unavailable. Request a new verification email or contact beta@kinresolve.com.";
const passwordResetRequestMessage = "If an eligible account matches that email, a password-reset message will arrive shortly. Check your inbox and spam folder.";
const passwordResetFailureMessage = "We could not reset the password from this link. Request a new password-reset message and try again.";
const genericLoginError = "Sign-in failed. Check your email and password and try again.";

let currentStage = "configuration";
let browser: Browser | undefined;
let pool: Pool | undefined;

void main().catch(() => {
  console.error(`Disposable identity browser canary failed during ${currentStage}.`);
  process.exitCode = 1;
}).finally(async () => {
  await browser?.close().catch(() => undefined);
  await pool?.end().catch(() => undefined);
});

async function main(): Promise<void> {
  const configuration = resolveIdentityBrowserCanaryConfiguration();
  process.env.DATABASE_AUTO_MIGRATE = "false";
  pool = new Pool({
    connectionString: configuration.databaseUrl,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 10_000,
    max: 4
  });

  currentStage = "fresh disposable database binding";
  const preflight = await assertDisposableDatabasePreflight(pool, configuration);
  const secrets = createIdentityCanarySecrets(configuration.runId);
  const serviceOptions = betaServiceOptions(configuration.archiveId, configuration);

  currentStage = "disposable invitation activation";
  await setBetaInvitationControl({
    operator: identityCanaryOperatorClaim(),
    reasonCode: "operator",
    state: "active"
  }, serviceOptions);

  currentStage = "synthetic identity preparation";
  const prepared = await prepareSyntheticIdentities(pool, configuration, secrets, serviceOptions);

  browser = await chromium.launch({ headless: configuration.headless });

  currentStage = "anonymous and public boundary";
  await withContext(configuration, async (context) => {
    currentStage = "anonymous protected and public redirects";
    await validateAnonymousAndPublicBoundary(context, configuration);
    currentStage = "anonymous API method contract";
    await validateInvalidApiMethod(context, configuration);
  });
  currentStage = "expired invitation denial";
  await withContext(configuration, async (_context, page) => {
    await validateUnavailableInvitation(page, configuration, prepared.expired.token);
  });
  currentStage = "expired invitation terminal state";
  await assertInvitationTerminalState(pool, prepared.expired.invitationId, "expired");
  currentStage = "revoked invitation denial";
  await withContext(configuration, async (_context, page) => {
    await validateUnavailableInvitation(page, configuration, prepared.revoked.token);
  });
  currentStage = "revoked invitation terminal state";
  await assertInvitationTerminalState(pool, prepared.revoked.invitationId, "revoked");

  currentStage = "invitation component and service acceptance";
  let verificationToken = "";
  await withContext(configuration, async (_context, page) => {
    verificationToken = await acceptOwnerInvitationThroughUiAndService(
      page,
      configuration,
      secrets.owner,
      prepared.ownerInvitationToken,
      serviceOptions
    );
    await validateVerificationUi(page, configuration, verificationToken);
  });

  currentStage = "single-use email verification";
  await withContext(configuration, async (_context, page) => {
    await validateUnavailableVerification(page, configuration, verificationToken);
  });
  verificationToken = "";

  currentStage = "membershipless authenticated denial";
  await validateDeniedAuthenticatedIdentity(configuration, secrets.membershipless);
  currentStage = "wrong-archive authenticated denial";
  await validateDeniedAuthenticatedIdentity(configuration, secrets.wrongArchive);

  currentStage = "verified owner sessions";
  const ownerContextOne = await createContext(configuration);
  const ownerContextTwo = await createContext(configuration);
  try {
    const ownerPageOne = await ownerContextOne.newPage();
    const ownerPageTwo = await ownerContextTwo.newPage();
    currentStage = "verified owner first sign-in";
    await signInAllowed(ownerPageOne, configuration, secrets.owner);
    // Better Auth independently caps production sign-ins at three per ten
    // seconds. The membershipless, wrong-archive, and first owner journeys
    // intentionally consume that window; cross it before creating session two.
    currentStage = "verified owner production sign-in window";
    await new Promise((resolve) => setTimeout(resolve, 11_000));
    currentStage = "verified owner second sign-in";
    await signInAllowed(ownerPageTwo, configuration, secrets.owner);
    currentStage = "verified owner first private API";
    await assertPrivateApiStatus(ownerContextOne, 200, configuration);
    currentStage = "verified owner second private API";
    await assertPrivateApiStatus(ownerContextTwo, 200, configuration);

    currentStage = "generic password recovery UI";
    await validateGenericForgotPassword(ownerPageOne, configuration, secrets.unknownRecoveryEmail);

    currentStage = "password reset owner binding";
    const ownerUserId = await readOwnerUserId(pool, secrets.owner.email);
    currentStage = "hashed password reset token seed";
    let passwordResetToken = await seedKnownPasswordReset(pool, ownerUserId);
    currentStage = "password reset browser consumption";
    await resetPasswordThroughBrowser(ownerPageOne, configuration, passwordResetToken, secrets.newOwnerPassword);

    currentStage = "password reset session revocation";
    await assertPrivateApiStatus(ownerContextOne, 401, configuration);
    await assertPrivateApiStatus(ownerContextTwo, 401, configuration);
    await assertProtectedPageDenied(ownerContextOne, configuration, "/app");
    await assertProtectedPageDenied(ownerContextTwo, configuration, "/app");

    currentStage = "old password denial";
    await withContext(configuration, async (_context, page) => {
      await signInRejected(page, configuration, secrets.owner.email, secrets.owner.password);
    });

    currentStage = "password reset token replay denial";
    await withContext(configuration, async (_context, page) => {
      await reusePasswordResetToken(page, configuration, passwordResetToken, secrets.newOwnerPassword);
    });
    passwordResetToken = "";
  } finally {
    await ownerContextOne.close().catch(() => undefined);
    await ownerContextTwo.close().catch(() => undefined);
  }

  currentStage = "new password sign-in";
  const ownerWithNewPassword = {
    ...secrets.owner,
    password: secrets.newOwnerPassword
  };
  await withContext(configuration, async (context, page) => {
    currentStage = "new password sign-in";
    await signInAllowed(page, configuration, ownerWithNewPassword);
    currentStage = "API token browser journey";
    await validateApiTokenJourney(page, context, configuration);
    currentStage = "disabled capability browser and route boundary";
    await validateDisabledCapabilities(page, context, configuration, preflight.publicationTargetPersonId);
    currentStage = "deterministic local analysis";
    await validateLocalAnalysis(page, context, configuration);
    currentStage = "logout denial";
    await validateLogoutDenial(page, context, configuration);
  });

  currentStage = "final disposable mutation boundary";
  await assertFinalProductMutationBoundary(pool, {
    archiveId: configuration.archiveId,
    baseline: preflight.baseline,
    publicationTargetPersonId: preflight.publicationTargetPersonId
  });

  console.log("Disposable identity, negative-capability, and API browser canary passed.");
  console.log("Invitation acceptance used the providerless UI/service harness; transactional email delivery remains a separate launch gate.");
}

async function prepareSyntheticIdentities(
  database: Pool,
  configuration: IdentityBrowserCanaryConfiguration,
  secrets: IdentityCanarySecrets,
  serviceOptions: BetaInvitationServiceOptions
): Promise<Readonly<{
  expired: { invitationId: string; token: string };
  ownerInvitationToken: string;
  revoked: { invitationId: string; token: string };
}>> {
  await seedMembershiplessAccount(database, secrets.membershipless);

  let ownerInvitationToken = "";
  await issueBetaInvitation({
    appBaseUrl: canonicalActionOrigin,
    deliver: async ({ actionUrl }) => {
      ownerInvitationToken = tokenFromActionUrl(actionUrl);
    },
    email: secrets.owner.email,
    expiresInSeconds: 60 * 60,
    operator: identityCanaryOperatorClaim(),
    purpose: "initial-owner",
    role: "owner"
  }, serviceOptions);
  if (!ownerInvitationToken) throw new Error("The synthetic owner invitation was not captured.");

  let revokedToken = "";
  const revoked = await issueBetaInvitation({
    appBaseUrl: canonicalActionOrigin,
    deliver: async ({ actionUrl }) => {
      revokedToken = tokenFromActionUrl(actionUrl);
    },
    email: `revoked-${configuration.runId}@example.test`,
    expiresInSeconds: 60 * 60,
    operator: identityCanaryOperatorClaim(),
    purpose: "member",
    role: "viewer"
  }, serviceOptions);
  await revokeBetaInvitation({
    invitationId: revoked.invitationId,
    operator: identityCanaryOperatorClaim()
  }, serviceOptions);
  if (!revokedToken) throw new Error("The revoked synthetic invitation was not captured.");

  const expired = await seedExpiredInvitation(database, {
    archiveId: configuration.archiveId,
    email: `expired-${configuration.runId}@example.test`,
    privacyHmacSecret: requiredPrivateEnvironment("KINRESOLVE_BETA_PRIVACY_HMAC_SECRET")
  });

  const wrongArchiveId = `archive-wrong-${configuration.runId.replaceAll("-", "").slice(-20)}`;
  await provisionArchive("empty", {
    archiveId: wrongArchiveId,
    databaseUrl: configuration.databaseUrl,
    datasetMode: "empty"
  });
  const wrongOptions = betaServiceOptions(wrongArchiveId, configuration);
  let wrongInvitationToken = "";
  await issueBetaInvitation({
    appBaseUrl: canonicalActionOrigin,
    deliver: async ({ actionUrl }) => {
      wrongInvitationToken = tokenFromActionUrl(actionUrl);
    },
    email: secrets.wrongArchive.email,
    expiresInSeconds: 60 * 60,
    operator: identityCanaryOperatorClaim(),
    purpose: "initial-owner",
    role: "owner"
  }, wrongOptions);
  let wrongVerificationToken = "";
  await acceptBetaInvitation({
    appBaseUrl: canonicalActionOrigin,
    deliverVerification: async ({ actionUrl }) => {
      wrongVerificationToken = tokenFromActionUrl(actionUrl);
    },
    email: secrets.wrongArchive.email,
    legalAcceptance: legalAcceptance(),
    name: secrets.wrongArchive.name,
    password: secrets.wrongArchive.password,
    requestId: randomUUID(),
    token: wrongInvitationToken
  }, wrongOptions);
  await verifyBetaEmail({ requestId: randomUUID(), token: wrongVerificationToken }, wrongOptions);
  wrongInvitationToken = "";
  wrongVerificationToken = "";

  return {
    expired,
    ownerInvitationToken,
    revoked: { invitationId: revoked.invitationId, token: revokedToken }
  };
}

async function acceptOwnerInvitationThroughUiAndService(
  page: Page,
  configuration: IdentityBrowserCanaryConfiguration,
  owner: SyntheticCredentials,
  invitationToken: string,
  serviceOptions: BetaInvitationServiceOptions
): Promise<string> {
  let capturedVerificationToken = "";
  let intercepted = false;
  let interceptionFailed = false;
  const acceptUrl = `${configuration.origin}/api/beta/invitations/accept`;

  // This one-request providerless harness exercises the real form payload and
  // the same atomic service used by the route. It intentionally does not claim
  // Resend transport coverage; that requires a controlled inbox at launch.
  await page.route(acceptUrl, async (route) => {
    intercepted = true;
    try {
      const request = route.request();
      const body = request.postDataJSON() as JsonRecord;
      if (
        request.method() !== "POST"
        || body.token !== invitationToken
        || body.email !== owner.email
        || body.name !== owner.name
        || body.password !== owner.password
        || !isCurrentBetaLegalAcceptance(body.acceptance, loadApprovedBetaLegalManifest(process.env))
      ) {
        throw new Error("The synthetic acceptance payload is invalid.");
      }
      const accepted = await acceptBetaInvitation({
        appBaseUrl: canonicalActionOrigin,
        deliverVerification: async ({ actionUrl }) => {
          capturedVerificationToken = tokenFromActionUrl(actionUrl);
        },
        email: owner.email,
        legalAcceptance: legalAcceptance(),
        name: owner.name,
        password: owner.password,
        requestId: randomUUID(),
        token: invitationToken
      }, serviceOptions);
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          purpose: accepted.purpose,
          role: accepted.role,
          verificationDelivery: accepted.verificationDelivery,
          verificationRequired: true
        })
      });
    } catch {
      interceptionFailed = true;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Synthetic acceptance unavailable" })
      });
    }
  });

  try {
    await exactGoto(page, configuration, `/invite#token=${encodeURIComponent(invitationToken)}`);
    await expectVisible(page.getByRole("heading", { level: 1, name: "Join the Kin Resolve private beta" }));
    await expectVisible(page.getByRole("heading", { level: 2, name: "Invitation details" }));
    await expectVisible(page.getByText("Owner", { exact: true }));
    if (new URL(page.url()).hash !== "") throw new Error();
    await page.getByLabel("Name", { exact: true }).fill(owner.name);
    await page.getByLabel("Invited email", { exact: true }).fill(owner.email);
    await page.getByLabel("Password (10–128 characters)", { exact: true }).fill(owner.password);
    await page.getByLabel(
      "I accept the exact participation terms, privacy notice, and beta boundary identified above."
    ).check();
    await page.getByRole("button", { name: "Accept invitation" }).click();
    await expectVisible(page.getByText(
      "Your invitation was accepted. Check your email for a verification link before signing in.",
      { exact: true }
    ));
  } finally {
    await page.unroute(acceptUrl).catch(() => undefined);
  }

  if (!intercepted || interceptionFailed || !capturedVerificationToken) throw new Error();
  return capturedVerificationToken;
}

async function validateVerificationUi(
  page: Page,
  configuration: IdentityBrowserCanaryConfiguration,
  token: string
): Promise<void> {
  await exactGoto(page, configuration, `/verify-email#token=${encodeURIComponent(token)}`);
  await expectVisible(page.getByRole("heading", { level: 1, name: "Verify your email" }));
  await expectVisible(page.getByText(
    "Your email address is verified. You can now sign in to Kin Resolve.",
    { exact: true }
  ));
  await expectVisible(page.getByRole("link", { name: "Continue to sign in" }));
  if (new URL(page.url()).hash !== "") throw new Error();
}

async function validateUnavailableInvitation(
  page: Page,
  configuration: IdentityBrowserCanaryConfiguration,
  token: string
): Promise<void> {
  const denialStage = currentStage;
  currentStage = `${denialStage} navigation and inspection`;
  const [inspectionResponse] = await Promise.all([
    page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.origin === configuration.origin
        && url.pathname === "/api/beta/invitations/inspect"
        && response.request().method() === "POST";
    }, { timeout: configuration.timeoutMs }),
    exactGoto(page, configuration, `/invite#token=${encodeURIComponent(token)}`)
  ]);
  if (
    inspectionResponse.status() !== 400
    || !uuidPattern.test(inspectionResponse.headers()["x-request-id"] ?? "")
  ) {
    throw new Error();
  }
  currentStage = `${denialStage} public warning`;
  await expectReferencedWarning(page, invitationUnavailableMessage);
  currentStage = `${denialStage} fragment removal`;
  if (new URL(page.url()).hash !== "") throw new Error();
}

async function validateUnavailableVerification(
  page: Page,
  configuration: IdentityBrowserCanaryConfiguration,
  token: string
): Promise<void> {
  await exactGoto(page, configuration, `/verify-email#token=${encodeURIComponent(token)}`);
  await expectVisible(page.getByRole("heading", { level: 1, name: "Verify your email" }));
  await expectReferencedWarning(page, verificationUnavailableMessage);
  await expectVisible(page.getByRole("link", { name: "Request a new verification email" }));
  if (new URL(page.url()).hash !== "") throw new Error();
}

async function validateDeniedAuthenticatedIdentity(
  configuration: IdentityBrowserCanaryConfiguration,
  credentials: SyntheticCredentials
): Promise<void> {
  const denialStage = currentStage;
  await withContext(configuration, async (context, page) => {
    currentStage = `${denialStage} login form`;
    await exactGoto(page, configuration, "/login?next=/app");
    await fillHydratedLoginCredentials(page, credentials.email, credentials.password);
    const deniedNavigation = page.waitForNavigation({
      waitUntil: "load",
      timeout: configuration.timeoutMs
    });
    const signInResponse = waitForAuthSignInResponse(page, configuration);
    await page.getByRole("button", { name: "Sign in" }).click();
    currentStage = `${denialStage} sign-in response`;
    if (!(await signInResponse).ok()) throw new Error();
    currentStage = `${denialStage} protected navigation`;
    const finalResponse = await deniedNavigation;
    const finalUrl = new URL(page.url());
    if (
      finalResponse?.status() !== 200
      || finalUrl.origin !== configuration.origin
      || finalUrl.pathname !== "/login"
      || finalUrl.searchParams.size !== 1
      || finalUrl.searchParams.get("next") !== "/app"
    ) {
      throw new Error();
    }
    currentStage = `${denialStage} generic browser response`;
    await expectVisible(page.getByRole("heading", { level: 1, name: "Private beta workspace" }));
    if (await page.getByText(genericLoginError, { exact: true }).count() !== 0) throw new Error();
    currentStage = `${denialStage} authenticated session response`;
    const session = await context.request.get("/api/auth/get-session", { timeout: configuration.timeoutMs });
    if (session.status() !== 200) throw new Error();
    const sessionBody = await boundedJson(session, 32 * 1024);
    currentStage = `${denialStage} authenticated identity binding`;
    if (!isRecord(sessionBody.user) || sessionBody.user.email !== credentials.email) throw new Error();
    if (isRecord(sessionBody.session) && Object.hasOwn(sessionBody.session, "token")) throw new Error();
    currentStage = `${denialStage} private API denial`;
    await assertPrivateApiStatus(context, 401, configuration);
  });
}

async function validateGenericForgotPassword(
  page: Page,
  configuration: IdentityBrowserCanaryConfiguration,
  unknownEmail: string
): Promise<void> {
  await exactGoto(page, configuration, "/forgot-password");
  await expectVisible(page.getByRole("heading", { level: 1, name: "Reset your password" }));
  await page.getByLabel("Email", { exact: true }).fill(unknownEmail);
  await page.getByRole("button", { name: "Send password-reset email" }).click();
  await expectVisible(page.getByText(passwordResetRequestMessage, { exact: true }));
}

async function resetPasswordThroughBrowser(
  page: Page,
  configuration: IdentityBrowserCanaryConfiguration,
  token: string,
  newPassword: string
): Promise<void> {
  await exactGoto(page, configuration, `/reset-password#token=${encodeURIComponent(token)}`);
  await expectVisible(page.getByRole("heading", { level: 1, name: "Choose a new password" }));
  await expectVisible(page.getByLabel("New password (at least 10 characters)", { exact: true }));
  if (new URL(page.url()).hash !== "") throw new Error();
  await page.getByLabel("New password (at least 10 characters)", { exact: true }).fill(newPassword);
  await page.getByLabel("Confirm new password", { exact: true }).fill(newPassword);
  await page.getByRole("button", { name: "Reset password" }).click();
  await expectVisible(page.getByText(
    "Your password has been reset. Sign in with your new password.",
    { exact: true }
  ));
}

async function reusePasswordResetToken(
  page: Page,
  configuration: IdentityBrowserCanaryConfiguration,
  token: string,
  password: string
): Promise<void> {
  await exactGoto(page, configuration, `/reset-password#token=${encodeURIComponent(token)}`);
  await expectVisible(page.getByLabel("New password (at least 10 characters)", { exact: true }));
  if (new URL(page.url()).hash !== "") throw new Error();
  await page.getByLabel("New password (at least 10 characters)", { exact: true }).fill(password);
  await page.getByLabel("Confirm new password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Reset password" }).click();
  await expectVisible(page.getByText(passwordResetFailureMessage, { exact: true }));
}

async function signInAllowed(
  page: Page,
  configuration: IdentityBrowserCanaryConfiguration,
  credentials: SyntheticCredentials
): Promise<void> {
  const signInStage = currentStage;
  currentStage = `${signInStage} login form`;
  await exactGoto(page, configuration, "/login?next=/app");
  await expectVisible(page.getByRole("heading", { level: 1, name: "Private beta workspace" }));
  await fillHydratedLoginCredentials(page, credentials.email, credentials.password);
  const signInResponse = waitForAuthSignInResponse(page, configuration);
  await page.getByRole("button", { name: "Sign in" }).click();
  currentStage = `${signInStage} sign-in response`;
  const response = await signInResponse;
  if (!response.ok()) {
    currentStage = `${signInStage} sign-in HTTP ${response.status()}`;
    throw new Error();
  }
  currentStage = `${signInStage} workspace navigation`;
  await page.waitForURL((url) => url.origin === configuration.origin && url.pathname === "/app");
  currentStage = `${signInStage} workspace rendering`;
  await expectVisible(page.getByRole("heading", { level: 1, name: "Investigation Dashboard" }));
}

async function signInRejected(
  page: Page,
  configuration: IdentityBrowserCanaryConfiguration,
  email: string,
  password: string
): Promise<void> {
  await exactGoto(page, configuration, "/login?next=/app");
  await fillHydratedLoginCredentials(page, email, password);
  const signInResponse = waitForAuthSignInResponse(page, configuration);
  await page.getByRole("button", { name: "Sign in" }).click();
  if ((await signInResponse).ok()) throw new Error();
  await expectVisible(page.getByText(genericLoginError, { exact: true }));
  if (new URL(page.url()).pathname !== "/login") throw new Error();
}

async function fillHydratedLoginCredentials(
  page: Page,
  email: string,
  password: string
): Promise<void> {
  await page.waitForLoadState("networkidle");
  const emailField = page.getByLabel("Email", { exact: true });
  const passwordField = page.getByLabel("Password", { exact: true });
  await emailField.fill(email);
  await passwordField.fill(password);
  if (await emailField.inputValue() !== email || await passwordField.inputValue() !== password) {
    throw new Error();
  }
}

async function validateApiTokenJourney(
  page: Page,
  context: BrowserContext,
  configuration: IdentityBrowserCanaryConfiguration
): Promise<void> {
  currentStage = "API token settings navigation";
  await exactGoto(page, configuration, "/app/settings");
  currentStage = "API token developer control visibility";
  await expectVisible(page.getByRole("heading", { level: 2, name: "Developer API" }));
  const tokenName = `Identity canary ${configuration.runId}`;
  currentStage = "API token name field";
  const tokenNameField = page.getByLabel("Token name", { exact: true });
  if (await tokenNameField.count() !== 1) throw new Error();
  await tokenNameField.fill(tokenName);
  currentStage = "API token expiry field";
  const expiryField = page.getByRole("combobox", { name: "Expires after", exact: true });
  if (await expiryField.count() !== 1) throw new Error();
  await expiryField.selectOption({ value: "7" });
  if (await expiryField.inputValue() !== "7") throw new Error();
  currentStage = "API token scope group";
  const scopeGroup = page.getByRole("group", { name: "Scopes" });
  const scopeBoxes = scopeGroup.getByRole("checkbox");
  if (await scopeBoxes.count() !== 5) throw new Error();
  currentStage = "API token archive read default";
  if (!await scopeGroup.getByLabel(/archive:read/).isChecked()) throw new Error();
  for (const scope of ["cases:read", "sources:read", "reports:read", "archive:export"]) {
    currentStage = `API token ${scope} default denial`;
    if (await scopeGroup.getByLabel(new RegExp(scope.replace(":", "\\:"))).isChecked()) throw new Error();
  }
  currentStage = "API token mint and one-time display";
  await page.getByRole("button", { name: "Create token" }).click();
  await expectVisible(page.getByText("Shown once — copy this secret before dismissing it", { exact: true }));
  await expectVisible(page.getByText(
    "Token created. Copy it now; Kin Resolve cannot show it again.",
    { exact: true }
  ));
  let token = (await page.locator("pre.code-block").textContent())?.trim() ?? "";
  if (!apiTokenPattern.test(token)) throw new Error();

  currentStage = "API token authenticated metadata";
  const meta = await context.request.get("/api/v1/meta", {
    headers: { authorization: `Bearer ${token}` },
    maxRedirects: 0,
    timeout: configuration.timeoutMs
  });
  await assertApiMetaResponse(meta, configuration);

  currentStage = "API token one-time dismissal";
  await page.getByRole("button", { name: "I stored it securely" }).click();
  if (await page.locator("pre.code-block").count() !== 0) throw new Error();
  const bodyText = await page.locator("body").textContent();
  if (bodyText?.includes(token)) throw new Error();
  const tokenRow = page.getByRole("row").filter({ hasText: tokenName });
  await expectVisible(tokenRow);
  await expectVisible(tokenRow.getByText("archive:read", { exact: true }));
  currentStage = "API token revocation";
  await tokenRow.getByRole("button", { name: "Revoke" }).click();
  await tokenRow.getByRole("button", { name: "Confirm revoke" }).click();
  await expectVisible(page.getByText(
    "Token revoked. Its next API request will be denied.",
    { exact: true }
  ));
  await expectVisible(tokenRow.getByText("Revoked", { exact: true }));

  currentStage = "revoked API token denial";
  const revoked = await context.request.get("/api/v1/meta", {
    headers: { authorization: `Bearer ${token}` },
    maxRedirects: 0,
    timeout: configuration.timeoutMs
  });
  await assertApiInvalidTokenResponse(revoked);
  token = "";
}

async function validateDisabledCapabilities(
  page: Page,
  context: BrowserContext,
  configuration: IdentityBrowserCanaryConfiguration,
  publicationTargetPersonId: string
): Promise<void> {
  currentStage = "disabled capability manifest";
  await exactGoto(page, configuration, "/app/settings");
  for (const capability of [
    "DNA",
    "External AI",
    "Public archive",
    "Public publishing",
    "Binary evidence uploads",
    "Package media"
  ]) {
    await expectVisible(page.getByRole("row", { name: new RegExp(`${capability} Disabled`) }));
  }
  await expectVisible(page.getByRole("row", { name: /Plain GEDCOM Enabled/ }));
  await expectVisible(page.getByRole("heading", { level: 2, name: "Local analysis" }));
  await expectVisible(page.getByText("External AI disabled", { exact: true }));
  if (await page.getByRole("link", { name: "DNA Matches" }).count() !== 0) throw new Error();

  currentStage = "disabled DNA page";
  const dnaPage = await context.request.get("/app/dna", { maxRedirects: 0 });
  if (dnaPage.status() !== 404) throw new Error();
  currentStage = "disabled DNA APIs";
  await assertNotFoundJson(await context.request.get("/api/dna/matches"));
  await assertNotFoundJson(await sameOriginRequest(context, configuration, "POST", "/api/dna/import", {
    data: { csv: "name,total_cm\nSynthetic Match,42" }
  }));

  currentStage = "transcript-only evidence UI";
  await exactGoto(page, configuration, "/app/sources");
  await expectVisible(page.getByText(
    "Transcript-only in this private beta. Paste text or a transcript below; binary files stay on your device.",
    { exact: true }
  ));
  if (await page.locator('input[type="file"]').count() !== 0) throw new Error();
  currentStage = "disabled binary upload API";
  await assertNotFoundJson(await sameOriginRequest(context, configuration, "POST", "/api/uploads", {
    multipart: {}
  }));

  currentStage = "disabled package and media APIs";
  await assertNotFoundJson(await sameOriginRequest(
    context,
    configuration,
    "POST",
    "/api/integrations/synthetic-disabled-package/artifacts",
    { multipart: {} }
  ));
  await assertNotFoundJson(await context.request.get("/api/integration-media"));
  await assertNotFoundJson(await sameOriginRequest(context, configuration, "POST", "/api/imports", {
    data: { sourceName: "disabled", content: "0 HEAD\n0 TRLR\n" }
  }));
  await assertNotFoundJson(await sameOriginRequest(context, configuration, "POST", "/api/imports/uploads", {
    data: {}
  }));

  currentStage = "disabled publication UI";
  await exactGoto(page, configuration, "/app/publishing");
  await expectVisible(page.getByRole("heading", { level: 1, name: "Publication Readiness" }));
  await expectVisible(page.getByText("Readiness only", { exact: true }));
  await expectVisible(page.getByText("Public preview disabled", { exact: true }).first());
  if (await page.locator('a[href^="/people"]').count() !== 0) throw new Error();

  currentStage = "disabled person publishing UI";
  await exactGoto(page, configuration, `/app/people/${encodeURIComponent(publicationTargetPersonId)}`);
  await expectVisible(page.getByText("Privacy curation", { exact: true }));
  await expectVisible(page.getByText(
    "Public publishing is disabled for this private beta. Privacy review remains available.",
    { exact: true }
  ));
  await expectVisible(page.getByRole("button", { name: "Remove from public archive" }));
  if (await page.getByLabel("Published", { exact: true }).count() !== 0) throw new Error();
  currentStage = "disabled person publishing API";
  await assertNotFoundJson(
    await sameOriginRequest(
      context,
      configuration,
      "PATCH",
      `/api/people/${encodeURIComponent(publicationTargetPersonId)}/curation`,
      { data: { published: true } }
    ),
    "Person not found"
  );
}

async function validateLocalAnalysis(
  page: Page,
  context: BrowserContext,
  configuration: IdentityBrowserCanaryConfiguration
): Promise<void> {
  await exactGoto(page, configuration, "/app/ai");
  await expectVisible(page.getByText("Local only", { exact: true }));
  await expectVisible(page.getByText(/Runs deterministic local checks inside Kin Resolve, makes no external provider call/));
  const response = await sameOriginRequest(context, configuration, "POST", "/api/ai/analyze", {
    data: { question: "Which synthetic source-coverage gap should the disposable canary review?" }
  });
  if (response.status() !== 200) throw new Error();
  const body = await boundedJson(response, 256 * 1024);
  if (
    body.status !== "ready"
    || body.provider !== "local"
    || body.model !== "deterministic"
    || body.providerStatus !== "not_configured"
    || !Array.isArray(body.uncertainty)
    || !body.uncertainty.some((value) => typeof value === "string" && value.includes("no provider call was made"))
    || !isRecord(body.run)
    || body.run.provider !== "local"
    || body.run.model !== "deterministic"
  ) {
    throw new Error();
  }
}

async function validateLogoutDenial(
  page: Page,
  context: BrowserContext,
  configuration: IdentityBrowserCanaryConfiguration
): Promise<void> {
  await page.getByRole("button", { name: "Sign out" }).first().click();
  await page.waitForURL((url) => url.origin === configuration.origin && url.pathname === "/login");
  await assertProtectedPageDenied(context, configuration, "/app");
  await assertPrivateApiStatus(context, 401, configuration);
}

async function validateAnonymousAndPublicBoundary(
  context: BrowserContext,
  configuration: IdentityBrowserCanaryConfiguration
): Promise<void> {
  await assertProtectedPageDenied(context, configuration, "/app");
  await assertPrivateApiStatus(context, 401, configuration);
  for (const pathname of ["/", "/people", "/places", "/stories", "/kinsleuth"]) {
    const response = await context.request.get(pathname, { maxRedirects: 0, timeout: configuration.timeoutMs });
    if (![302, 303, 307, 308].includes(response.status())) throw new Error();
    const location = response.headers().location;
    if (!location) throw new Error();
    const target = new URL(location, configuration.origin);
    if (
      target.origin !== configuration.origin
      || target.pathname !== "/login"
      || target.searchParams.size !== 1
      || target.searchParams.get("next") !== "/app"
      || response.headers()["x-robots-tag"] !== "noindex, nofollow, noarchive"
    ) {
      throw new Error();
    }
  }
  const robots = await context.request.get("/robots.txt", { timeout: configuration.timeoutMs });
  const robotsText = await boundedText(robots, 4096);
  if (robots.status() !== 200 || !/^User-Agent: \*\s+Disallow: \/\s*$/m.test(robotsText)) throw new Error();
}

async function validateInvalidApiMethod(
  context: BrowserContext,
  configuration: IdentityBrowserCanaryConfiguration
): Promise<void> {
  const response = await context.request.post("/api/v1/meta", {
    data: {},
    maxRedirects: 0,
    timeout: configuration.timeoutMs
  });
  if (
    response.status() !== 405
    || response.headers().allow !== "GET"
    || response.headers()["cache-control"] !== "private, no-store, max-age=0"
    || response.headers().pragma !== "no-cache"
    || !varyIncludesAuthorization(response.headers().vary)
    || response.headers()["access-control-allow-origin"] !== undefined
  ) {
    throw new Error();
  }
  const body = await boundedJson(response, 16 * 1024);
  if (
    Object.keys(body).sort().join(",") !== "code,message,requestId"
    || body.code !== "method_not_allowed"
    || body.message !== "Method not allowed"
    || typeof body.requestId !== "string"
    || !uuidPattern.test(body.requestId)
  ) {
    throw new Error();
  }
}

async function assertApiMetaResponse(
  response: APIResponse,
  configuration: IdentityBrowserCanaryConfiguration
): Promise<void> {
  if (
    response.status() !== 200
    || response.headers()["cache-control"] !== "private, no-store, max-age=0"
    || response.headers().pragma !== "no-cache"
    || !varyIncludesAuthorization(response.headers().vary)
    || !/^[1-9][0-9]*$/.test(response.headers()["ratelimit-limit"] ?? "")
    || !/^[0-9]+$/.test(response.headers()["ratelimit-remaining"] ?? "")
    || !/^[1-9][0-9]*$/.test(response.headers()["ratelimit-reset"] ?? "")
  ) {
    throw new Error();
  }
  const body = await boundedJson(response, 64 * 1024);
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as JsonRecord;
  if (
    !isRecord(body.data)
    || body.data.apiVersion !== "v1"
    || body.data.productVersion !== packageJson.version
    || !isRecord(body.data.archive)
    || typeof body.data.archive.id !== "string"
    || !uuidPattern.test(body.data.archive.id)
    || body.data.archive.id === configuration.archiveId
    || !isRecord(body.data.capabilities)
    || body.data.capabilities.people !== true
    || body.data.capabilities.sources !== false
    || body.data.capabilities.cases !== false
    || body.data.capabilities.qualityReport !== false
    || body.data.capabilities.gedcomExport !== false
  ) {
    throw new Error();
  }
}

async function assertApiInvalidTokenResponse(response: APIResponse): Promise<void> {
  if (
    response.status() !== 401
    || response.headers()["www-authenticate"] !== 'Bearer realm="Kin Resolve API", error="invalid_token"'
    || response.headers()["cache-control"] !== "private, no-store, max-age=0"
    || !varyIncludesAuthorization(response.headers().vary)
  ) {
    throw new Error();
  }
  const body = await boundedJson(response, 16 * 1024);
  if (
    Object.keys(body).sort().join(",") !== "code,message,requestId"
    || body.code !== "invalid_token"
    || body.message !== "The bearer token is invalid, expired, or revoked."
    || typeof body.requestId !== "string"
    || !uuidPattern.test(body.requestId)
  ) {
    throw new Error();
  }
}

async function assertNotFoundJson(
  response: APIResponse,
  expectedError = "Not found"
): Promise<void> {
  if (response.status() !== 404) throw new Error();
  const body = await boundedJson(response, 16 * 1024);
  if (Object.keys(body).join(",") !== "error" || body.error !== expectedError) throw new Error();
}

async function assertPrivateApiStatus(
  context: BrowserContext,
  expectedStatus: 200 | 401,
  configuration: IdentityBrowserCanaryConfiguration
): Promise<void> {
  const response = await context.request.get("/api/people", {
    maxRedirects: 0,
    timeout: configuration.timeoutMs
  });
  if (response.status() !== expectedStatus) throw new Error();
  if (expectedStatus === 401) {
    const body = await boundedJson(response, 16 * 1024);
    if (Object.keys(body).join(",") !== "error" || body.error !== "Authentication required") throw new Error();
  }
}

async function assertProtectedPageDenied(
  context: BrowserContext,
  configuration: IdentityBrowserCanaryConfiguration,
  pathname: string
): Promise<void> {
  const response = await context.request.get(pathname, {
    maxRedirects: 0,
    timeout: configuration.timeoutMs
  });
  if (![302, 303, 307, 308].includes(response.status())) throw new Error();
  const location = response.headers().location;
  if (!location) throw new Error();
  const target = new URL(location, configuration.origin);
  if (
    target.origin !== configuration.origin
    || target.pathname !== "/login"
    || target.searchParams.size !== 1
    || target.searchParams.get("next") !== pathname
  ) {
    throw new Error();
  }
}

async function sameOriginRequest(
  context: BrowserContext,
  configuration: IdentityBrowserCanaryConfiguration,
  method: "PATCH" | "POST",
  pathname: string,
  options: Readonly<{ data?: unknown; multipart?: Record<string, string> }>
): Promise<APIResponse> {
  return context.request.fetch(pathname, {
    method,
    headers: {
      origin: configuration.origin,
      "sec-fetch-site": "same-origin"
    },
    ...(options.data === undefined ? {} : { data: options.data }),
    ...(options.multipart === undefined ? {} : { multipart: options.multipart }),
    maxRedirects: 0,
    timeout: configuration.timeoutMs
  });
}

async function exactGoto(
  page: Page,
  configuration: IdentityBrowserCanaryConfiguration,
  path: string
): Promise<void> {
  const response = await page.goto(new URL(path, `${configuration.origin}/`).href, {
    waitUntil: "load",
    timeout: configuration.timeoutMs
  });
  if (!response || response.status() !== 200 || new URL(page.url()).origin !== configuration.origin) {
    throw new Error();
  }
}

async function expectVisible(locator: ReturnType<Page["locator"]>): Promise<void> {
  await locator.waitFor({ state: "visible" });
}

async function expectReferencedWarning(page: Page, message: string): Promise<void> {
  const warning = page.locator("span.status.warning").filter({ hasText: message });
  await expectVisible(warning);
  const rendered = (await warning.textContent())?.trim() ?? "";
  const prefix = `${message} Reference: `;
  if (!rendered.startsWith(prefix) || !rendered.endsWith(".")) throw new Error();
  const requestId = rendered.slice(prefix.length, -1);
  if (!uuidPattern.test(requestId)) throw new Error();
}

function waitForAuthSignInResponse(
  page: Page,
  configuration: IdentityBrowserCanaryConfiguration
): Promise<BrowserResponse> {
  return page.waitForResponse((response) => (
    response.request().method() === "POST"
    && new URL(response.url()).origin === configuration.origin
    && new URL(response.url()).pathname === "/api/auth/sign-in/email"
  ));
}

async function boundedText(response: APIResponse, maximumBytes: number): Promise<string> {
  const declared = response.headers()["content-length"];
  if (declared && (!/^[0-9]+$/.test(declared) || Number(declared) > maximumBytes)) throw new Error();
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > maximumBytes) throw new Error();
  return text;
}

async function boundedJson(response: APIResponse, maximumBytes: number): Promise<JsonRecord> {
  const contentType = response.headers()["content-type"] ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) throw new Error();
  const parsed: unknown = JSON.parse(await boundedText(response, maximumBytes));
  if (!isRecord(parsed)) throw new Error();
  return parsed;
}

async function createContext(configuration: IdentityBrowserCanaryConfiguration): Promise<BrowserContext> {
  if (!browser) throw new Error();
  const context = await browser.newContext({ baseURL: configuration.origin });
  context.setDefaultTimeout(configuration.timeoutMs);
  context.setDefaultNavigationTimeout(configuration.timeoutMs);
  return context;
}

async function withContext(
  configuration: IdentityBrowserCanaryConfiguration,
  action: (context: BrowserContext, page: Page) => Promise<void>
): Promise<void> {
  const context = await createContext(configuration);
  try {
    const page = await context.newPage();
    await action(context, page);
  } finally {
    await context.close().catch(() => undefined);
  }
}

function betaServiceOptions(
  archiveId: string,
  configuration: IdentityBrowserCanaryConfiguration
): BetaInvitationServiceOptions {
  return {
    archiveId,
    databaseUrl: configuration.databaseUrl,
    legalEnvironment: process.env,
    privacyHmacSecret: requiredPrivateEnvironment("KINRESOLVE_BETA_PRIVACY_HMAC_SECRET"),
    validateLegalDocuments: async () => undefined
  };
}

function legalAcceptance() {
  const manifest = loadApprovedBetaLegalManifest(process.env);
  return {
    participationTermsVersion: manifest.participationTerms.version,
    participationTermsSha256: manifest.participationTerms.sha256,
    participationTermsUrl: manifest.participationTerms.url,
    privacyNoticeVersion: manifest.privacyNotice.version,
    privacyNoticeSha256: manifest.privacyNotice.sha256,
    privacyNoticeUrl: manifest.privacyNotice.url,
    betaBoundaryVersion: manifest.betaBoundary.version,
    betaBoundarySha256: manifest.betaBoundary.sha256,
    betaBoundaryUrl: manifest.betaBoundary.url,
    accepted: true as const
  };
}

function requiredPrivateEnvironment(name: string): string {
  const value = process.env[name];
  if (!value || Buffer.byteLength(value, "utf8") < 32) throw new Error();
  return value;
}

function varyIncludesAuthorization(value: string | undefined): boolean {
  return value?.split(",").some((entry) => entry.trim().toLowerCase() === "authorization") === true;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

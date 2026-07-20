import type { BetterAuthOptions } from "better-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createHostedPasswordRecovery,
  notifyHostedSessionsRevoked,
  passwordResetTokenExpiresInSeconds,
  type AuthEmailDeferredTask,
  type AuthEmailSecurityAuditInput
} from "@/lib/auth-email";
import type {
  TransactionalEmailConfig,
  TransactionalEmailMessage,
  TransactionalEmailTransport
} from "@/lib/transactional-email";

const authModuleMocks = vi.hoisted(() => ({
  after: vi.fn(),
  betterAuth: vi.fn(),
  getPool: vi.fn(() => ({ kind: "test-pool" })),
  nextCookies: vi.fn(() => ({ id: "next-cookies" }))
}));

vi.mock("next/server", () => ({ after: authModuleMocks.after }));
vi.mock("better-auth", () => ({ betterAuth: authModuleMocks.betterAuth }));
vi.mock("better-auth/next-js", () => ({ nextCookies: authModuleMocks.nextCookies }));
vi.mock("@/lib/db", () => ({ getPool: authModuleMocks.getPool }));

const hostedEmailEnvironment = {
  APP_BASE_URL: "https://app.kinresolve.com",
  KINRESOLVE_TRANSACTIONAL_EMAIL_PROVIDER: "resend",
  KINRESOLVE_TRANSACTIONAL_EMAIL_FROM: "Kin Resolve <beta@kinresolve.com>",
  KINRESOLVE_TRANSACTIONAL_EMAIL_REPLY_TO: "beta@kinresolve.com",
  RESEND_API_KEY: "re_test_1234567890abcdefghijkl"
};

const resetToken = "resetToken1234567890abcdef";
const fixedNow = new Date("2026-07-15T18:00:00.000Z");

function captureTransport() {
  const messages: TransactionalEmailMessage[] = [];
  const transport: TransactionalEmailTransport = {
    send: vi.fn(async (message) => {
      messages.push(message);
      return { provider: "test", messageId: "message-safe-123" };
    })
  };
  const createTransport = vi.fn((_config: TransactionalEmailConfig) => transport);
  return { messages, transport, createTransport };
}

function captureAudit() {
  const events: AuthEmailSecurityAuditInput[] = [];
  const recordSecurityAudit = vi.fn(async (event: AuthEmailSecurityAuditInput) => {
    events.push(event);
  });
  return { events, recordSecurityAudit };
}

function setBaseAuthEnvironment(): void {
  vi.stubEnv("AUTH_SECRET", "auth-email-test-secret-value");
  vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
  vi.stubEnv("KINRESOLVE_DEPLOYMENT_MODE", "self-hosted");
  vi.stubEnv("KINRESOLVE_DATASET_MODE", "demo");
}

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  // Vitest 4: restoreAllMocks no longer clears vi.fn() call history, so the
  // hoisted module mocks must be cleared explicitly between tests.
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  authModuleMocks.after.mockImplementation(() => undefined);
  authModuleMocks.betterAuth.mockImplementation((options: unknown) => ({ options }));
  authModuleMocks.getPool.mockReturnValue({ kind: "test-pool" });
  authModuleMocks.nextCookies.mockReturnValue({ id: "next-cookies" });
  setBaseAuthEnvironment();
});

describe("Better Auth hosted recovery configuration", () => {
  it("enforces hosted account policy, bounded recovery, hashed identifiers, and session revocation", async () => {
    vi.stubEnv("APP_BASE_URL", hostedEmailEnvironment.APP_BASE_URL);
    vi.stubEnv("KINRESOLVE_DEPLOYMENT_MODE", "hosted");
    vi.stubEnv("KINRESOLVE_DATASET_MODE", "pilot");

    const { getAuth } = await import("@/lib/auth");
    getAuth();

    const options = authModuleMocks.betterAuth.mock.calls[0][0] as BetterAuthOptions;
    expect(options.emailAndPassword).toMatchObject({
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: true,
      resetPasswordTokenExpiresIn: passwordResetTokenExpiresInSeconds,
      revokeSessionsOnPasswordReset: true
    });
    expect(options.emailAndPassword?.sendResetPassword).toBeTypeOf("function");
    expect(options.emailAndPassword?.onPasswordReset).toBeTypeOf("function");
    expect(options.verification?.storeIdentifier).toBe("hashed");
    expect(options.session?.additionalFields?.token).toMatchObject({
      fieldName: "token",
      returned: false,
      unique: true
    });
    expect(options.advanced?.backgroundTasks?.handler).toBeTypeOf("function");

    options.advanced?.backgroundTasks?.handler(Promise.resolve());
    expect(authModuleMocks.after).toHaveBeenCalledOnce();
    expect(authModuleMocks.after.mock.calls[0][0]).toBeTypeOf("function");
  });

  it("preserves self-hosted sign-up, unverified sign-in, and disabled outbound recovery", async () => {
    const { getAuth } = await import("@/lib/auth");
    getAuth();

    const options = authModuleMocks.betterAuth.mock.calls[0][0] as BetterAuthOptions;
    expect(options.emailAndPassword).toMatchObject({
      enabled: true,
      disableSignUp: false,
      requireEmailVerification: false,
      minPasswordLength: 10,
      maxPasswordLength: 128
    });
    expect(options.emailAndPassword?.sendResetPassword).toBeUndefined();
    expect(options.emailAndPassword?.onPasswordReset).toBeUndefined();
    expect(options.advanced?.backgroundTasks).toBeUndefined();
  });
});

describe("Better Auth password recovery email callbacks", () => {
  it("defers the entire provider and audit task, then sends the exact canonical fragment link", async () => {
    const tasks: AuthEmailDeferredTask[] = [];
    const { messages, createTransport } = captureTransport();
    const { events, recordSecurityAudit } = captureAudit();
    const recovery = createHostedPasswordRecovery({
      environment: hostedEmailEnvironment,
      createTransport,
      recordSecurityAudit,
      schedule: (task) => { tasks.push(task); },
      now: () => fixedNow
    });

    await recovery.sendResetPassword({
      user: { id: "user-private-123", email: "researcher@example.com" },
      url: "https://attacker.example/reset?token=leaked-in-query",
      token: resetToken
    });

    expect(createTransport).not.toHaveBeenCalled();
    expect(messages).toHaveLength(0);
    expect(events).toHaveLength(0);
    expect(tasks).toHaveLength(1);
    await expect(tasks[0]()).resolves.toBeUndefined();

    expect(messages).toHaveLength(1);
    const message = messages[0];
    const expectedUrl = `${hostedEmailEnvironment.APP_BASE_URL}/reset-password#token=${resetToken}`;
    expect(message).toMatchObject({
      kind: "password-reset",
      to: "researcher@example.com",
      subject: "Reset your Kin Resolve password"
    });
    expect(message.text).toContain(expectedUrl);
    expect(message.html).toContain(expectedUrl);
    expect(message.text).not.toContain("attacker.example");
    expect(message.text).toContain("Wed, 15 Jul 2026 18:30:00 GMT");
    expect(message.idempotencyKey).toMatch(/^kinresolve:password-reset:[a-f0-9]{64}$/);
    expect(message.idempotencyKey).not.toContain(resetToken);
    expect(events.map((event) => event.eventType).sort()).toEqual([
      "password-recovery-requested",
      "security-notification-delivered"
    ]);
    expect(JSON.stringify(events)).not.toContain("researcher@example.com");
    expect(JSON.stringify(events)).not.toContain(resetToken);
  });

  it("derives a stable token-specific idempotency key", async () => {
    const tasks: AuthEmailDeferredTask[] = [];
    const { messages, createTransport } = captureTransport();
    const recovery = createHostedPasswordRecovery({
      environment: hostedEmailEnvironment,
      createTransport,
      recordSecurityAudit: async () => undefined,
      schedule: (task) => { tasks.push(task); },
      now: () => fixedNow
    });
    const send = (token: string) => recovery.sendResetPassword({
      user: { id: "user-private-123", email: "researcher@example.com" },
      url: "https://unused.example",
      token
    });

    await send(resetToken);
    await send(resetToken);
    await send("differentResetToken123456789");
    expect(messages).toHaveLength(0);
    for (const task of tasks) await task();

    expect(messages[0].idempotencyKey).toBe(messages[1].idempotencyKey);
    expect(messages[2].idempotencyKey).not.toBe(messages[0].idempotencyKey);
  });

  it("swallows delivery and configuration failures without logging sensitive values", async () => {
    const tasks: AuthEmailDeferredTask[] = [];
    const leak = `${resetToken} researcher@example.com re_provider_secret body-secret`;
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const transport: TransactionalEmailTransport = {
      send: async () => { throw new Error(leak); }
    };
    const recovery = createHostedPasswordRecovery({
      environment: hostedEmailEnvironment,
      createTransport: () => transport,
      recordSecurityAudit: async () => undefined,
      schedule: (task) => { tasks.push(task); },
      now: () => fixedNow
    });

    await expect(recovery.sendResetPassword({
      user: { id: "user-private-123", email: "researcher@example.com" },
      url: "https://unused.example",
      token: resetToken
    })).resolves.toBeUndefined();
    await expect(tasks.shift()?.()).resolves.toBeUndefined();

    const misconfigured = createHostedPasswordRecovery({
      environment: { ...hostedEmailEnvironment, RESEND_API_KEY: leak },
      createTransport: () => transport,
      recordSecurityAudit: async () => undefined,
      schedule: (task) => { tasks.push(task); },
      now: () => fixedNow
    });
    await expect(misconfigured.sendResetPassword({
      user: { id: "user-private-123", email: "researcher@example.com" },
      url: "https://unused.example",
      token: resetToken
    })).resolves.toBeUndefined();
    await expect(tasks.shift()?.()).resolves.toBeUndefined();

    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("defers password-changed notification and catches failure before returning to session revocation", async () => {
    const tasks: AuthEmailDeferredTask[] = [];
    const { events, recordSecurityAudit } = captureAudit();
    const createTransport = vi.fn((_config: TransactionalEmailConfig): TransactionalEmailTransport => ({
      send: vi.fn(async () => { throw new Error("provider-secret-marker"); })
    }));
    const recovery = createHostedPasswordRecovery({
      environment: hostedEmailEnvironment,
      createTransport,
      recordSecurityAudit,
      schedule: (task) => { tasks.push(task); },
      now: () => fixedNow
    });

    await expect(recovery.onPasswordReset({
      user: { id: "user-private-123", email: "researcher@example.com" }
    })).resolves.toBeUndefined();

    expect(createTransport).not.toHaveBeenCalled();
    expect(tasks).toHaveLength(1);
    await expect(tasks[0]()).resolves.toBeUndefined();
    expect(createTransport).toHaveBeenCalledOnce();
    expect(events.map((event) => event.eventType).sort()).toEqual([
      "password-changed",
      "password-recovery-completed",
      "security-notification-delivery-failed"
    ]);
    expect(events).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ eventType: "sessions-revoked" })
    ]));
  });

  it("exposes a contained post-revocation notification and audit seam", async () => {
    const tasks: AuthEmailDeferredTask[] = [];
    const { messages, createTransport } = captureTransport();
    const { events, recordSecurityAudit } = captureAudit();
    const revocationRequestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

    await expect(notifyHostedSessionsRevoked({
      requestId: revocationRequestId,
      user: { id: "user-private-123", email: "researcher@example.com" }
    }, {
      environment: hostedEmailEnvironment,
      createTransport,
      recordSecurityAudit,
      schedule: (task) => { tasks.push(task); },
      now: () => fixedNow
    })).resolves.toBeUndefined();

    expect(messages).toHaveLength(0);
    expect(events).toHaveLength(0);
    expect(tasks).toHaveLength(1);
    await expect(tasks[0]()).resolves.toBeUndefined();

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      kind: "security-notification",
      subject: "Your Kin Resolve sessions were signed out",
      to: "researcher@example.com"
    });
    expect(events.map((event) => event.eventType).sort()).toEqual([
      "security-notification-delivered",
      "sessions-revoked"
    ]);
    expect(events.find((event) => event.eventType === "sessions-revoked")?.actorKind).toBe("participant");
    expect(events.find((event) => event.eventType === "security-notification-delivered")?.actorKind).toBe("system");
    expect(new Set(events.map((event) => event.requestId))).toEqual(new Set([revocationRequestId]));
    expect(JSON.stringify(events)).not.toContain("researcher@example.com");
  });

  it("contains rejected background promises even when scheduling is unavailable", async () => {
    const recovery = createHostedPasswordRecovery({
      environment: hostedEmailEnvironment,
      createTransport: captureTransport().createTransport,
      recordSecurityAudit: async () => undefined,
      schedule: () => { throw new Error("no request context with secret-marker"); },
      now: () => fixedNow
    });

    expect(() => recovery.backgroundTaskHandler(Promise.reject(
      new Error("email-token-body-provider-secret-marker")
    ))).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

import { describe, expect, it, vi } from "vitest";

import {
  betaApplicationMaximumBodyBytes,
  handleBetaApplicationPost,
  readBetaApplicationForm
} from "@/lib/beta-application-http";
import type { ConsumeDurableAuthRateLimitInput } from "@/lib/durable-auth-rate-limit";
import type { NormalizedBetaApplication } from "@/lib/beta-applications";

const environment = {
  KINRESOLVE_BETA_APPLICATIONS_ENABLED: "true",
  KINRESOLVE_BETA_APPLICATION_HMAC_SECRET: "a".repeat(32),
  VERCEL: "1"
};

function validFields(overrides: Record<string, string> = {}) {
  return {
    archive_size_band: "1000-10000",
    consent: "accepted",
    consent_version: "beta-communications-v1",
    current_tool: "gramps",
    email: "pilot@example.com",
    name: "Pilot Researcher",
    researcher_type: "family-historian",
    website: "",
    workflow: "research-cases",
    ...overrides
  };
}

function encoded(fields: Record<string, string> = validFields()) {
  return new URLSearchParams(fields).toString();
}

function request(
  body = encoded(),
  headers: Record<string, string> = {},
  options: { origin?: string; includeLength?: boolean } = {}
) {
  const includeLength = options.includeLength ?? true;
  return new Request("https://app.kinresolve.com/api/public/beta-applications", {
    body,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: options.origin ?? "https://kinresolve.com",
      "x-vercel-forwarded-for": "203.0.113.7",
      ...(includeLength ? { "content-length": String(Buffer.byteLength(body)) } : {}),
      ...headers
    },
    method: "POST"
  });
}

function allowingConsume() {
  return vi.fn(async () => ({ allowed: true, remaining: 4, retryAfterSeconds: 0 }));
}

describe("beta application native-form request parser", () => {
  it.each([
    "application/x-www-form-urlencoded",
    "Application/X-Www-Form-Urlencoded; Charset=UTF-8"
  ])("accepts the strict native media type variant %s", async (contentType) => {
    const parsed = await readBetaApplicationForm(request(encoded(), { "content-type": contentType }));
    expect(parsed.get("email")).toBe("pilot@example.com");
  });

  it.each([
    "application/json",
    "application/x-www-form-urlencoded; charset=iso-8859-1",
    "application/x-www-form-urlencoded; charset=utf-8; boundary=nope"
  ])("rejects unsupported content type %s", async (contentType) => {
    await expect(readBetaApplicationForm(request(encoded(), { "content-type": contentType })))
      .rejects.toMatchObject({ status: 415 });
  });

  it("accepts a missing Content-Length but rejects false, malformed, and oversized declarations", async () => {
    await expect(readBetaApplicationForm(request(encoded(), {}, { includeLength: false }))).resolves.toBeInstanceOf(URLSearchParams);
    await expect(readBetaApplicationForm(request(encoded(), { "content-length": "1" })))
      .rejects.toMatchObject({ status: 400 });
    await expect(readBetaApplicationForm(request(encoded(), { "content-length": "+10" })))
      .rejects.toMatchObject({ status: 400 });
    await expect(readBetaApplicationForm(request(encoded(), {
      "content-length": String(betaApplicationMaximumBodyBytes + 1)
    }))).rejects.toMatchObject({ status: 413 });
  });

  it("enforces the actual streamed cap and rejects compressed request bodies", async () => {
    const body = `name=${"x".repeat(betaApplicationMaximumBodyBytes)}`;
    await expect(readBetaApplicationForm(request(body, {}, { includeLength: false })))
      .rejects.toMatchObject({ status: 413 });
    await expect(readBetaApplicationForm(request(encoded(), { "content-encoding": "gzip" })))
      .rejects.toMatchObject({ status: 415 });
    await expect(readBetaApplicationForm(request(encoded(), { "content-encoding": "identity" })))
      .resolves.toBeInstanceOf(URLSearchParams);
  });

  it.each([
    `${encoded()}&email=second@example.com`,
    `${encoded()}&unknown=value`,
    encoded(Object.fromEntries(Object.entries(validFields()).filter(([key]) => key !== "workflow"))),
    encoded({ ...validFields(), name: "%ZZ" }).replace("%25ZZ", "%ZZ"),
    encoded({ ...validFields(), name: "%FF" }).replace(/%25FF/g, "%FF")
  ])("rejects duplicate, unknown, missing, or malformed fields", async (body) => {
    await expect(readBetaApplicationForm(request(body))).rejects.toMatchObject({ status: 400 });
  });
});

describe("beta application public POST handler", () => {
  it("fails closed for disabled or malformed runtime flags", async () => {
    const disabled = await handleBetaApplicationPost(request(), {
      environment: { KINRESOLVE_BETA_APPLICATIONS_ENABLED: "false" }
    });
    const malformed = await handleBetaApplicationPost(request(), {
      environment: { KINRESOLVE_BETA_APPLICATIONS_ENABLED: "TRUE" }
    });
    expect(disabled.status).toBe(404);
    expect(malformed.status).toBe(503);
  });

  it.each([
    ["unapproved origin", request(encoded(), {}, { origin: "https://evil.example" })],
    ["cookie", request(encoded(), { cookie: "session=secret" })],
    ["authorization", request(encoded(), { authorization: "Bearer secret" })]
  ])("rejects %s without consuming a bucket or reflecting private input", async (_label, incoming) => {
    const consume = allowingConsume();
    const submit = vi.fn();
    const response = await handleBetaApplicationPost(incoming, { consume, environment, submit });
    expect(response.status).toBe(403);
    expect(consume).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(await response.text()).not.toMatch(/evil|session|secret|pilot@example/i);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("gives a filled honeypot the exact success redirect without persistence, mail, or rate limits", async () => {
    const consume = allowingConsume();
    const submit = vi.fn();
    const response = await handleBetaApplicationPost(request(encoded(validFields({ website: "spam.example" }))), {
      consume,
      environment,
      submit
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://kinresolve.com/beta/thanks/");
    expect(consume).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it.each([
    ["missing consent", { consent: "" }],
    ["expired consent version", { consent_version: "beta-communications-v0" }],
    ["invalid enum", { workflow: "tell-you-my-family-story" }],
    ["transport-incompatible mailbox", { email: "unicode@exämple.test" }]
  ])("rejects %s before rate limiting and never creates an address oracle", async (_label, overrides) => {
    const consume = allowingConsume();
    const response = await handleBetaApplicationPost(request(encoded(validFields(overrides))), {
      consume,
      environment,
      submit: vi.fn()
    });
    expect(response.status).toBe(400);
    expect(consume).not.toHaveBeenCalled();
    const text = await response.text();
    expect(text).toBe("The beta application request could not be processed.");
    const supplied = Object.values(overrides)[0];
    if (supplied) expect(text).not.toContain(supplied);
  });

  it("uses the platform-derived network subject first, then the normalized email subject", async () => {
    const calls: ConsumeDurableAuthRateLimitInput[] = [];
    const consume = vi.fn(async (input: ConsumeDurableAuthRateLimitInput) => {
      calls.push(input);
      return { allowed: true, remaining: 4, retryAfterSeconds: 0 };
    });
    let submitted: NormalizedBetaApplication | undefined;
    const submit = vi.fn(async (application: NormalizedBetaApplication) => {
      submitted = application;
      return { applicationId: crypto.randomUUID(), duplicate: false };
    });
    const response = await handleBetaApplicationPost(request(encoded(validFields({
      email: " PILOT@EXAMPLE.COM "
    }))), { consume, environment, submit });
    expect(response.status).toBe(303);
    expect(calls.map(({ scope }) => scope)).toEqual([
      "beta-application:network",
      "beta-application:email"
    ]);
    expect(calls[0]?.subject).toBe("client-address:203.0.113.7");
    expect(calls[1]?.subject).toBe("email:pilot@example.com");
    expect(submitted).toMatchObject({ email: "pilot@example.com" });
  });

  it.each(["network", "email"])("returns a bounded Retry-After only when the %s bucket is truly exhausted", async (limited) => {
    const consume = vi.fn(async (input: ConsumeDurableAuthRateLimitInput) => ({
      allowed: !input.scope.endsWith(limited),
      remaining: 0,
      retryAfterSeconds: 417
    }));
    const submit = vi.fn();
    const response = await handleBetaApplicationPost(request(), { consume, environment, submit });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("417");
    expect(submit).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain("pilot@example.com");
  });

  it("returns only the fixed 303 and no CORS headers after a successful persistence/delivery", async () => {
    const response = await handleBetaApplicationPost(request(), {
      consume: allowingConsume(),
      environment,
      submit: vi.fn(async () => ({ applicationId: crypto.randomUUID(), duplicate: false }))
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://kinresolve.com/beta/thanks/");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("");
  });

  it("redacts persistence, provider, and network failures without logging applicant or secret data", async () => {
    const privateMarker = "re_secret-provider-network-pilot@example.com";
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await handleBetaApplicationPost(request(), {
      consume: allowingConsume(),
      environment,
      submit: vi.fn(async () => { throw new Error(privateMarker); })
    });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(privateMarker);
    expect([log, info, warn, error].every((spy) => spy.mock.calls.length === 0)).toBe(true);
    vi.restoreAllMocks();
  });
});

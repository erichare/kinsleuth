import { describe, expect, it } from "vitest";

import { evaluateSameOriginRequest } from "@/lib/same-origin-request";

const productionEnvironment = {
  NODE_ENV: "production",
  APP_BASE_URL: "https://app.kinresolve.com"
} as const;

describe("same-origin cookie request policy", () => {
  it("accepts only the exact canonical origin and same-origin fetch metadata", () => {
    expect(evaluateSameOriginRequest(request({
      origin: "https://app.kinresolve.com",
      fetchSite: "same-origin"
    }), productionEnvironment)).toBe("allowed");
  });

  it.each([
    undefined,
    "null",
    "https://kinresolve.com",
    "https://preview.app.kinresolve.com",
    "http://app.kinresolve.com",
    "https://app.kinresolve.com:444",
    "https://app.kinresolve.com/",
    "https://app.kinresolve.com, https://attacker.example"
  ])("rejects the non-canonical Origin value %s", (origin) => {
    expect(evaluateSameOriginRequest(request({ origin, fetchSite: "same-origin" }), productionEnvironment))
      .toBe("forbidden");
  });

  it.each([undefined, "same-site", "cross-site", "none", "SAME-ORIGIN"])(
    "rejects the Fetch Metadata value %s",
    (fetchSite) => {
      expect(evaluateSameOriginRequest(request({
        origin: "https://app.kinresolve.com",
        fetchSite
      }), productionEnvironment)).toBe("forbidden");
    }
  );

  it.each([
    {},
    { APP_BASE_URL: "not a URL" },
    { APP_BASE_URL: "http://app.kinresolve.com" },
    { APP_BASE_URL: "https://user:pass@app.kinresolve.com" },
    { APP_BASE_URL: "https://app.kinresolve.com/base" },
    { APP_BASE_URL: "https://app.kinresolve.com?query=1" },
    { APP_BASE_URL: "https://app.kinresolve.com#fragment" }
  ])("fails closed for the production canonical-origin configuration %#", (overrides) => {
    expect(evaluateSameOriginRequest(request({
      origin: "https://app.kinresolve.com",
      fetchSite: "same-origin"
    }), { NODE_ENV: "production", ...overrides })).toBe("misconfigured");
  });

  it("uses the request origin only when development has no configured canonical origin", () => {
    expect(evaluateSameOriginRequest(request({
      requestUrl: "http://localhost:3000/api/cases",
      origin: "http://localhost:3000",
      fetchSite: "same-origin"
    }), { NODE_ENV: "development" })).toBe("allowed");
    expect(evaluateSameOriginRequest(request({
      requestUrl: "http://localhost:3000/api/cases",
      origin: "http://127.0.0.1:3000",
      fetchSite: "same-origin"
    }), { NODE_ENV: "development" })).toBe("forbidden");
  });
});

function request(input: {
  requestUrl?: string;
  origin?: string;
  fetchSite?: string;
}): Request {
  const headers = new Headers();
  if (input.origin !== undefined) headers.set("origin", input.origin);
  if (input.fetchSite !== undefined) headers.set("sec-fetch-site", input.fetchSite);
  return new Request(input.requestUrl ?? "https://release-preview.vercel.app/api/cases", {
    method: "POST",
    headers
  });
}

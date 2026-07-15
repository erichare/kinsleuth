import { renderToStaticMarkup } from "react-dom/server";
import { createElement, Fragment, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/public-shell", () => ({
  PublicShell: ({ children }: { children: ReactNode }) => createElement(Fragment, null, children)
}));
vi.mock("@/components/login-form", () => ({
  LoginForm: () => createElement("div", null, "login-form")
}));

import LoginPage from "@/app/login/page";

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("KINRESOLVE_DEPLOYMENT_MODE", "self-hosted");
  vi.stubEnv("KINRESOLVE_DATASET_MODE", "demo");
});

describe("hosted login page", () => {
  it("uses capability-neutral private-beta copy and does not advertise setup", async () => {
    vi.stubEnv("KINRESOLVE_DEPLOYMENT_MODE", "hosted");
    vi.stubEnv("KINRESOLVE_DATASET_MODE", "pilot");

    const html = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({}) }));

    expect(html).toMatch(/private beta workspace/i);
    expect(html).not.toMatch(/DNA|source uploads|href="\/setup"/i);
  });

  it("preserves first-run guidance for self-hosted operators", async () => {
    const html = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({}) }));

    expect(html).toMatch(/DNA matches, source uploads, and investigations/i);
    expect(html).toContain('href="/setup"');
  });
});

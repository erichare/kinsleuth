import { renderToStaticMarkup } from "react-dom/server";
import { createElement, Fragment, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pageMocks = vi.hoisted(() => ({
  countUsers: vi.fn(),
  redirect: vi.fn()
}));

vi.mock("@/lib/auth-session", () => ({ countUsers: pageMocks.countUsers }));
vi.mock("next/navigation", () => ({ redirect: pageMocks.redirect }));
vi.mock("@/components/public-shell", () => ({
  PublicShell: ({ children }: { children: ReactNode }) => createElement(Fragment, null, children)
}));
vi.mock("@/components/setup-form", () => ({
  SetupForm: () => createElement("div", null, "owner-setup-form")
}));
vi.mock("@/components/icons", () => ({ Icons: { ChevronRight: () => null } }));

import SetupPage from "@/app/setup/page";

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("KINRESOLVE_DEPLOYMENT_MODE", "self-hosted");
  vi.stubEnv("KINRESOLVE_DATASET_MODE", "demo");
  pageMocks.countUsers.mockResolvedValue(0);
  pageMocks.redirect.mockImplementation(() => {
    throw new Error("NEXT_REDIRECT");
  });
});

describe("hosted setup page", () => {
  it("redirects hosted callers to login before counting accounts", async () => {
    vi.stubEnv("KINRESOLVE_DEPLOYMENT_MODE", "hosted");
    vi.stubEnv("KINRESOLVE_DATASET_MODE", "pilot");

    await expect(SetupPage()).rejects.toThrow("NEXT_REDIRECT");

    expect(pageMocks.redirect).toHaveBeenCalledWith("/login");
    expect(pageMocks.countUsers).not.toHaveBeenCalled();
  });

  it("preserves the owner setup form for an empty self-hosted deployment", async () => {
    const html = renderToStaticMarkup(await SetupPage());

    expect(pageMocks.redirect).not.toHaveBeenCalled();
    expect(pageMocks.countUsers).toHaveBeenCalledOnce();
    expect(html).toContain("owner-setup-form");
  });
});

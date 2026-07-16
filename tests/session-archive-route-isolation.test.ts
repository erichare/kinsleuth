import { afterEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  buildPublicationReview: vi.fn(() => ({ profiles: [], blockers: [] })),
  readWorkspace: vi.fn(async () => ({ people: [] })),
  searchPeoplePageFromDb: vi.fn(async () => ({
    items: [],
    page: 1,
    pageSize: 50,
    pageCount: 1,
    total: 0,
    start: 0,
    end: 0,
    stats: { total: 0, published: 0, protectedCount: 0, living: 0 }
  }))
}));

vi.mock("@/lib/auth-session", () => ({
  getSessionContext: vi.fn(async () => ({
    kind: "member",
    userId: "owner-private",
    email: "owner@example.com",
    name: "Owner",
    role: "owner",
    archiveId: "archive-private"
  })),
  workspaceOptionsForSession: vi.fn((session: { archiveId: string }) => ({
    archiveId: session.archiveId
  }))
}));
vi.mock("@/lib/publishing", () => ({ buildPublicationReview: routeMocks.buildPublicationReview }));
vi.mock("@/lib/store/people-queries", () => ({ searchPeoplePageFromDb: routeMocks.searchPeoplePageFromDb }));
vi.mock("@/lib/workspace-store", () => ({ readWorkspace: routeMocks.readWorkspace }));

import { GET as GET_PEOPLE } from "@/app/api/people/route";
import { GET as GET_PUBLISHING_READINESS } from "@/app/api/publishing/readiness/route";

afterEach(() => {
  vi.clearAllMocks();
});

describe("session archive route isolation", () => {
  it("scopes people search to the authenticated session archive", async () => {
    const response = await GET_PEOPLE(new Request("https://app.kinresolve.com/api/people?page=2&pageSize=25"));

    expect(response.status).toBe(200);
    expect(routeMocks.searchPeoplePageFromDb).toHaveBeenCalledWith(
      expect.objectContaining({ sort: "name" }),
      { page: 2, pageSize: 25 },
      { archiveId: "archive-private" }
    );
  });

  it("scopes publishing readiness to the authenticated session archive", async () => {
    const response = await GET_PUBLISHING_READINESS(
      new Request("https://app.kinresolve.com/api/publishing/readiness?pageSize=25")
    );

    expect(response.status).toBe(200);
    expect(routeMocks.readWorkspace).toHaveBeenCalledWith({ archiveId: "archive-private" });
  });
});

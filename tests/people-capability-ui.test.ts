import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PeopleWorkspace } from "@/components/people-workspace";
import type { PeopleSearchResult } from "@/lib/people-search";

const result: PeopleSearchResult = {
  items: [
    {
      id: "person-1",
      slug: "ada-example",
      displayName: "Ada Example",
      aliases: ["Ada Northwood"],
      surname: "Example",
      livingStatus: "deceased",
      privacy: "private",
      published: true,
      factCount: 2
    }
  ],
  page: 1,
  pageSize: 50,
  pageCount: 1,
  total: 1,
  start: 1,
  end: 1,
  stats: {
    total: 2,
    published: 1,
    protectedCount: 1,
    living: 0
  }
};

describe("people capability UI", () => {
  it("keeps hosted beta people private without publication controls or claims", () => {
    const html = renderToStaticMarkup(createElement(PeopleWorkspace, {
      initialResult: result,
      publicArchiveEnabled: false,
      publicPublishingEnabled: false
    }));

    expect(html).toMatch(/private beta/i);
    expect(html).toMatch(/privacy readiness/i);
    expect(html).not.toMatch(/public profiles/i);
    expect(html).not.toMatch(/publication review/i);
    expect(html).not.toMatch(/>Publication</i);
    expect(html).not.toMatch(/>published</i);
  });

  it("preserves publication status and filters for self-hosted deployments", () => {
    const html = renderToStaticMarkup(createElement(PeopleWorkspace, {
      initialResult: result,
      publicArchiveEnabled: true,
      publicPublishingEnabled: true
    }));

    expect(html).toMatch(/public profiles/i);
    expect(html).toMatch(/publication review/i);
    expect(html).toMatch(/>Publication</i);
    expect(html).toMatch(/>published</i);
    expect(html).toMatch(/also recorded as Ada Northwood/i);
  });
});

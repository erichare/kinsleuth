import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDatabasePools, query } from "@/lib/db";
import { createCase, createNewCase, readWorkspace } from "@/lib/workspace-store";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;

let storeOptions: { databaseUrl: string; archiveId: string };

beforeEach(() => {
  if (!databaseUrl) return;
  storeOptions = { databaseUrl, archiveId: `test-new-case-${randomUUID()}` };
});

afterEach(async () => {
  if (!databaseUrl) return;
  await query("DELETE FROM archives WHERE id = $1", [storeOptions.archiveId], { databaseUrl });
});

afterAll(async () => {
  await closeDatabasePools();
});

describeIfDatabase("new case persistence boundary", () => {
  it("generates unique parent and child ids with open, empty research histories", async () => {
    const input = {
      title: "A bounded identity question",
      question: "Do these fictional records describe the same person?",
      focus: "Compare independent identifiers",
      hypotheses: [
        {
          statement: "The records describe the same person.",
          confidence: 0.45
        }
      ],
      evidence: [
        {
          title: "Initial evidence note",
          type: "Research note",
          summary: "Two signatures share an unusual final stroke.",
          confidence: 0.5
        }
      ]
    };

    const first = await createNewCase(input, storeOptions);
    const second = await createNewCase(input, storeOptions);
    const workspace = await readWorkspace(storeOptions);

    expect(second.id).not.toBe(first.id);
    expect(second.hypotheses[0].id).not.toBe(first.hypotheses[0].id);
    expect(second.evidence[0].id).not.toBe(first.evidence[0].id);
    expect(first.hypotheses[0]).toMatchObject({ status: "open", decisions: [] });
    expect(second.hypotheses[0]).toMatchObject({ status: "open", decisions: [] });
    expect(first.tasks).toEqual([]);
    expect(second.tasks).toEqual([]);
    expect(workspace.cases.filter((item) => item.title === input.title)).toHaveLength(2);
  });

  it("cannot overwrite an existing case by reusing its id", async () => {
    await createCase(
      {
        id: "case-insert-only",
        title: "Original case",
        question: "What does the original evidence show?"
      },
      storeOptions
    );

    await expect(
      createCase(
        {
          id: "case-insert-only",
          title: "Attacker replacement",
          question: "Can this overwrite the original?"
        },
        storeOptions
      )
    ).rejects.toMatchObject({ code: "23505" });

    const workspace = await readWorkspace(storeOptions);
    expect(workspace.cases.find((item) => item.id === "case-insert-only")).toMatchObject({
      title: "Original case",
      question: "What does the original evidence show?"
    });
  });

  it("rolls back instead of moving or overwriting colliding child ids", async () => {
    await createCase(
      {
        id: "case-child-owner",
        title: "Original child owner",
        question: "Which case owns these child rows?",
        hypotheses: [
          {
            id: "hyp-child-collision",
            statement: "The original hypothesis.",
            confidence: 0.5,
            status: "open"
          }
        ],
        evidence: [
          {
            id: "ev-child-collision",
            title: "Original evidence",
            type: "Research note",
            summary: "Original summary.",
            confidence: 0.5
          }
        ]
      },
      storeOptions
    );

    await expect(
      createCase(
        {
          id: "case-child-collision-attempt",
          title: "Collision attempt",
          question: "Can child ids move between cases?",
          hypotheses: [
            {
              id: "hyp-child-collision",
              statement: "Replacement hypothesis.",
              confidence: 1,
              status: "rejected"
            }
          ],
          evidence: [
            {
              id: "ev-child-collision",
              title: "Replacement evidence",
              type: "Research note",
              summary: "Replacement summary.",
              confidence: 1
            }
          ]
        },
        storeOptions
      )
    ).rejects.toMatchObject({ code: "23505" });

    const workspace = await readWorkspace(storeOptions);
    const original = workspace.cases.find((item) => item.id === "case-child-owner");
    expect(workspace.cases.some((item) => item.id === "case-child-collision-attempt")).toBe(false);
    expect(original?.hypotheses[0]).toMatchObject({
      id: "hyp-child-collision",
      statement: "The original hypothesis."
    });
    expect(original?.evidence[0]).toMatchObject({
      id: "ev-child-collision",
      title: "Original evidence",
      summary: "Original summary."
    });
  });
});

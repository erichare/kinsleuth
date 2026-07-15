import { describe, expect, it } from "vitest";

import { resolveIntegrationIdentitiesForTest } from "@/lib/integrations/run-processor";

describe("integration identity matcher scale", () => {
  it("requires review when a remembered xref is reused for a different stable provider identity", () => {
    const resolved = resolveIntegrationIdentitiesForTest({
      incoming: [{
        entityType: "person",
        externalId: "@I1@",
        identityKey: "new-person",
        providerIds: ["_UID:new-stable-person"]
      }],
      base: [{
        entityType: "person",
        externalId: "@I1@",
        localEntityId: "person-original",
        incomingHash: "hash-original",
        identityKey: "original-person",
        providerIds: ["_UID:original-stable-person"]
      }],
      rememberedRefs: {
        "person:@I1@": "person-original"
      },
      connectionId: "integration-reused-xref-fixture"
    });

    expect(resolved.localIds["person:@I1@"]).not.toBe("person-original");
    expect(resolved.ambiguous["person:@I1@"]).toEqual(["person-original"]);
  });

  it("matches a fully renumbered 50,000-person tree through indexed identities", () => {
    const size = 50_000;
    const base = Array.from({ length: size }, (_, index) => ({
      entityType: "person" as const,
      externalId: `@I${index + 1}@`,
      localEntityId: `person-${index + 1}`,
      incomingHash: `hash-${index + 1}`,
      identityKey: `identity-${index + 1}`
    }));
    const incoming = Array.from({ length: size }, (_, index) => ({
      entityType: "person" as const,
      externalId: `@P${size - index}@`,
      identityKey: `identity-${index + 1}`
    }));

    const resolved = resolveIntegrationIdentitiesForTest({
      incoming,
      base,
      connectionId: "integration-scale-fixture"
    });

    expect(Object.keys(resolved.localIds)).toHaveLength(size);
    expect(resolved.localIds[`person:@P${size}@`]).toBe("person-1");
    expect(resolved.localIds["person:@P1@"]).toBe(`person-${size}`);
    expect(resolved.ambiguous).toEqual({});
  }, 10_000);
});

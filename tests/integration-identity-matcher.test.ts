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

  it("keeps distinct local identities for incoming records that share a provider tag value", () => {
    const resolved = resolveIntegrationIdentitiesForTest({
      incoming: [
        {
          entityType: "person",
          externalId: "@I1@",
          identityKey: "first-person",
          providerIds: ["REFN:42"]
        },
        {
          entityType: "person",
          externalId: "@I2@",
          identityKey: "second-person",
          providerIds: ["REFN:42"]
        },
        {
          entityType: "source",
          externalId: "@S1@",
          identityKey: "first-source",
          providerIds: ["_APID:1,8054::0"]
        },
        {
          entityType: "source",
          externalId: "@S2@",
          identityKey: "second-source",
          providerIds: ["_APID:1,8054::0"]
        }
      ],
      base: [],
      connectionId: "integration-shared-provider-id-fixture"
    });

    expect(resolved.localIds["person:@I1@"]).not.toBe(resolved.localIds["person:@I2@"]);
    expect(resolved.localIds["source:@S1@"]).not.toBe(resolved.localIds["source:@S2@"]);
    expect(resolved.ambiguous).toEqual({});
  });

  it("still seeds from a unique provider identifier when another one is shared", () => {
    const resolveWith = (renumbered: boolean) => resolveIntegrationIdentitiesForTest({
      incoming: [
        {
          entityType: "person",
          externalId: renumbered ? "@R1@" : "@I1@",
          identityKey: "first-person",
          providerIds: ["REFN:42", "_UID:stable-first"]
        },
        {
          entityType: "person",
          externalId: renumbered ? "@R2@" : "@I2@",
          identityKey: "second-person",
          providerIds: ["REFN:42", "_UID:stable-second"]
        }
      ],
      base: [],
      connectionId: "integration-mixed-provider-id-fixture"
    });

    const original = resolveWith(false);
    const renumbered = resolveWith(true);
    // The unique _UID keeps the assignment stable across an xref renumbering;
    // the shared REFN contributes nothing to identity.
    expect(renumbered.localIds["person:@R1@"]).toBe(original.localIds["person:@I1@"]);
    expect(renumbered.localIds["person:@R2@"]).toBe(original.localIds["person:@I2@"]);
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

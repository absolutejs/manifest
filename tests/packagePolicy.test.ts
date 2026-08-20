import { describe, expect, test } from "bun:test";
import { validatePackagePeerDependencies } from "../src";

describe("package peer dependency policy", () => {
  test("accepts standard peer dependency metadata without custom declarations", () => {
    expect(
      validatePackagePeerDependencies({
        peerDependencies: { elysia: "^2.0.0-beta.6" },
        peerDependenciesMeta: { elysia: { optional: true } },
      }),
    ).toEqual({ issues: [], ok: true });
  });

  test("rejects a host-owned peer duplicated in dependencies", () => {
    const result = validatePackagePeerDependencies({
      dependencies: { elysia: "2.0.0-beta.6" },
      peerDependencies: { elysia: "^2.0.0-beta.6" },
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected peer dependency rejection");
    expect(result.issues).toEqual([
      {
        code: "dependency_conflict",
        message:
          "elysia is host-owned through peerDependencies and must not also appear in dependencies",
        peer: "elysia",
      },
    ]);
  });

  test("rejects metadata for an undeclared peer", () => {
    const result = validatePackagePeerDependencies({
      peerDependenciesMeta: { elysia: { optional: true } },
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected peer metadata rejection");
    expect(result.issues).toEqual([
      {
        code: "orphan_peer_metadata",
        message:
          "elysia appears in peerDependenciesMeta but not peerDependencies",
        peer: "elysia",
      },
    ]);
  });
});

import { describe, expect, test } from "bun:test";
import {
  type PackageRuntimePolicyInput,
  validatePackageArtifactPolicy,
  validatePackageRuntimePolicy,
} from "../src";

const validPackage = () => ({
  absolutejs: {
    runtimePeers: {
      "@absolutejs/agency": {
        artifactImports: ["@absolutejs/agency"],
        buildExternals: ["@absolutejs/agency", "@absolutejs/agency/*"],
        range: ">=0.7.1 <0.8.0",
        tested: "0.7.1",
      },
    },
  },
  devDependencies: { "@absolutejs/agency": "0.7.1" },
  peerDependencies: { "@absolutejs/agency": ">=0.7.1 <0.8.0" },
  scripts: {
    build:
      "bun build src/index.ts --external @absolutejs/agency --external '@absolutejs/agency/*'",
  },
});

describe("shared runtime package policy", () => {
  test("accepts one tested, externalized host peer", () => {
    expect(validatePackageRuntimePolicy(validPackage())).toEqual({
      issues: [],
      ok: true,
    });
  });

  test("rejects every peer that has not been explicitly classified", () => {
    const result = validatePackageRuntimePolicy({
      devDependencies: {
        "@absolutejs/agency": "0.7.1",
        "drizzle-orm": "1.0.0-rc.4",
      },
      peerDependencies: {
        "@absolutejs/agency": ">=0.7.1 <0.8.0",
        "drizzle-orm": ">=1.0.0-rc.4 <2",
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected package policy rejection");
    expect(result.issues).toEqual([
      {
        code: "unclassified_peer",
        message:
          "@absolutejs/agency is a peer dependency and must be classified in absolutejs.runtimePeers",
        runtime: "@absolutejs/agency",
      },
      {
        code: "unclassified_peer",
        message:
          "drizzle-orm is a peer dependency and must be classified in absolutejs.runtimePeers",
        runtime: "drizzle-orm",
      },
    ]);
  });

  test("rejects a partially classified peer set", () => {
    const candidate = validPackage();
    const result = validatePackageRuntimePolicy({
      ...candidate,
      devDependencies: {
        ...candidate.devDependencies,
        "drizzle-orm": "1.0.0-rc.4",
      },
      peerDependencies: {
        ...candidate.peerDependencies,
        "drizzle-orm": ">=1.0.0-rc.4 <2",
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected package policy rejection");
    expect(result.issues.map(({ code }) => code)).toEqual([
      "unclassified_peer",
    ]);
  });

  test("rejects a private dependency, stale peer, and untested dev version", () => {
    const candidate: PackageRuntimePolicyInput = {
      ...validPackage(),
      dependencies: { "@absolutejs/agency": "0.6.4" },
      devDependencies: { "@absolutejs/agency": "0.6.4" },
      peerDependencies: { "@absolutejs/agency": "^0.6.0" },
    };
    const result = validatePackageRuntimePolicy(candidate);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected package policy rejection");
    expect(result.issues.map(({ code }) => code)).toEqual([
      "dependency_conflict",
      "peer_range_mismatch",
      "dev_dependency_mismatch",
    ]);
  });

  test("binds optionality and every declared build external", () => {
    const base = validPackage();
    const candidate: PackageRuntimePolicyInput = {
      ...base,
      absolutejs: {
        runtimePeers: {
          "@absolutejs/agency": {
            ...base.absolutejs.runtimePeers["@absolutejs/agency"],
            optional: true,
          },
        },
      },
      scripts: { build: "bun build src/index.ts" },
    };
    const result = validatePackageRuntimePolicy(candidate);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected package policy rejection");
    expect(result.issues.map(({ code }) => code)).toEqual([
      "optional_mismatch",
      "external_missing",
      "external_missing",
    ]);
  });

  test("requires declared runtime imports to survive the build", () => {
    const result = validatePackageArtifactPolicy(validPackage(), {
      "dist/index.js": 'import { Agency } from "@absolutejs/agency";',
    });

    expect(result).toEqual({ issues: [], ok: true });
  });

  test("rejects a runtime embedded into the built artifact", () => {
    const result = validatePackageArtifactPolicy(validPackage(), {
      "dist/index.js": "var embeddedAgencyRuntime = {};",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected artifact policy rejection");
    expect(result.issues.map(({ code }) => code)).toEqual([
      "artifact_import_missing",
    ]);
  });

  test("rejects malformed policy metadata", () => {
    const result = validatePackageRuntimePolicy({
      absolutejs: {
        runtimePeers: {
          "@absolutejs/agency": {
            artifactImports: [],
            buildExternals: ["@absolutejs/agency", "@absolutejs/agency"],
            range: "",
            tested: "^0.7.1",
          },
        },
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected package policy rejection");
    expect(result.issues.map(({ code }) => code)).toEqual(["invalid_policy"]);
  });
});

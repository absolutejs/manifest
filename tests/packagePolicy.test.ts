import { describe, expect, test } from "bun:test";
import {
  type PackageRuntimePolicyInput,
  validatePackageRuntimePolicy,
} from "../src";

const validPackage = () => ({
  absolutejs: {
    runtimePeers: {
      "@absolutejs/agency": {
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

  test("rejects malformed policy metadata", () => {
    const result = validatePackageRuntimePolicy({
      absolutejs: {
        runtimePeers: {
          "@absolutejs/agency": {
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

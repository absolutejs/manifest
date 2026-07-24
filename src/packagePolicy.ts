export type RuntimePeerPolicy = {
  buildExternals?: readonly string[];
  optional?: boolean;
  range: string;
  tested: string;
};

export type PackageRuntimePolicyIssue = {
  code:
    | "dependency_conflict"
    | "dev_dependency_mismatch"
    | "external_missing"
    | "invalid_policy"
    | "optional_mismatch"
    | "peer_range_mismatch";
  message: string;
  runtime?: string;
};

export type PackageRuntimePolicyResult =
  | { issues: readonly []; ok: true }
  | { issues: readonly PackageRuntimePolicyIssue[]; ok: false };

export type PackageRuntimePolicyInput = {
  absolutejs?: { runtimePeers?: unknown };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  scripts?: Record<string, string>;
};

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasExternal = (build: string, specifier: string) =>
  [
    `--external ${specifier}`,
    `--external '${specifier}'`,
    `--external "${specifier}"`,
    `--external=${specifier}`,
    `--external='${specifier}'`,
    `--external="${specifier}"`,
  ].some((candidate) => build.includes(candidate));

const parseBuildExternals = (value: unknown) => {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    !value.every(
      (specifier) => typeof specifier === "string" && specifier.length > 0,
    )
  )
    return undefined;

  return value;
};

const parsedPolicy = (
  runtime: string,
  value: unknown,
  issues: PackageRuntimePolicyIssue[],
) => {
  if (!isRecord(value)) {
    issues.push({
      code: "invalid_policy",
      message: `absolutejs.runtimePeers["${runtime}"] must be an object`,
      runtime,
    });

    return undefined;
  }
  const { buildExternals, optional, range, tested } = value;
  const externalList = parseBuildExternals(buildExternals);
  if (
    runtime.length === 0 ||
    typeof range !== "string" ||
    range.length === 0 ||
    typeof tested !== "string" ||
    !EXACT_VERSION.test(tested) ||
    (optional !== undefined && typeof optional !== "boolean") ||
    externalList === undefined ||
    new Set(externalList).size !== externalList.length
  ) {
    issues.push({
      code: "invalid_policy",
      message: `absolutejs.runtimePeers["${runtime}"] requires a non-empty range, exact tested version, optional boolean, and unique buildExternals`,
      runtime,
    });

    return undefined;
  }

  return {
    buildExternals: externalList,
    optional: optional === true,
    range,
    tested,
  } satisfies RuntimePeerPolicy;
};

const validateDeclaredRuntime = (
  packageJson: PackageRuntimePolicyInput,
  runtime: string,
  policy: RuntimePeerPolicy,
  issues: PackageRuntimePolicyIssue[],
) => {
  if (packageJson.dependencies?.[runtime] !== undefined)
    issues.push({
      code: "dependency_conflict",
      message: `${runtime} is host-owned and must not appear in dependencies`,
      runtime,
    });
  if (packageJson.peerDependencies?.[runtime] !== policy.range)
    issues.push({
      code: "peer_range_mismatch",
      message: `${runtime} peer range must be exactly "${policy.range}"`,
      runtime,
    });
  if (packageJson.devDependencies?.[runtime] !== policy.tested)
    issues.push({
      code: "dev_dependency_mismatch",
      message: `${runtime} dev dependency must be exactly "${policy.tested}"`,
      runtime,
    });

  const declaredOptional =
    packageJson.peerDependenciesMeta?.[runtime]?.optional === true;
  if (declaredOptional !== policy.optional)
    issues.push({
      code: "optional_mismatch",
      message: `${runtime} peer optionality must be ${String(policy.optional)}`,
      runtime,
    });

  const build = packageJson.scripts?.build ?? "";
  for (const specifier of policy.buildExternals ?? [])
    if (!hasExternal(build, specifier))
      issues.push({
        code: "external_missing",
        message: `build must externalize ${specifier} for host-owned runtime ${runtime}`,
        runtime,
      });
};

export const validatePackageRuntimePolicy = (
  packageJson: PackageRuntimePolicyInput,
) => {
  const configured = packageJson.absolutejs?.runtimePeers;
  if (configured === undefined)
    return { issues: [], ok: true } satisfies PackageRuntimePolicyResult;
  if (!isRecord(configured))
    return {
      issues: [
        {
          code: "invalid_policy",
          message: "absolutejs.runtimePeers must be an object",
        },
      ],
      ok: false,
    } satisfies PackageRuntimePolicyResult;

  const issues: PackageRuntimePolicyIssue[] = [];
  for (const [runtime, value] of Object.entries(configured)) {
    const policy = parsedPolicy(runtime, value, issues);
    if (policy) validateDeclaredRuntime(packageJson, runtime, policy, issues);
  }

  return issues.length === 0
    ? ({ issues: [], ok: true } satisfies PackageRuntimePolicyResult)
    : ({ issues, ok: false } satisfies PackageRuntimePolicyResult);
};

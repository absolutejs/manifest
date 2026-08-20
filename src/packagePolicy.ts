export type PackagePeerDependencyIssue = {
  code: "dependency_conflict" | "orphan_peer_metadata";
  message: string;
  peer: string;
};

export type PackagePeerDependencyResult =
  | { issues: readonly []; ok: true }
  | { issues: readonly PackagePeerDependencyIssue[]; ok: false };

export type PackagePeerDependencyInput = {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};

/**
 * Validate relationships that can be derived from standard package.json
 * fields. `peerDependencies` is the sole declaration that a runtime is owned
 * by the host; build tools remain responsible for their own external config.
 */
const validatePackagePeerDependencies = (
  packageJson: PackagePeerDependencyInput,
) => {
  const issues: PackagePeerDependencyIssue[] = [];
  const peers = packageJson.peerDependencies ?? {};

  for (const peer of Object.keys(peers))
    if (packageJson.dependencies?.[peer] !== undefined)
      issues.push({
        code: "dependency_conflict",
        message: `${peer} is host-owned through peerDependencies and must not also appear in dependencies`,
        peer,
      });

  for (const peer of Object.keys(packageJson.peerDependenciesMeta ?? {}))
    if (peers[peer] === undefined)
      issues.push({
        code: "orphan_peer_metadata",
        message: `${peer} appears in peerDependenciesMeta but not peerDependencies`,
        peer,
      });

  return issues.length === 0
    ? ({ issues: [], ok: true } satisfies PackagePeerDependencyResult)
    : ({ issues, ok: false } satisfies PackagePeerDependencyResult);
};

export { validatePackagePeerDependencies };

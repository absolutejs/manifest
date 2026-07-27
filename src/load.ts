import { Value } from "@sinclair/typebox/value";
import { manifestSchema, serializeManifest } from "./schema";
import { inspectManifestSecurity } from "./security";
import {
  TOOL_NAME_PATTERN,
  type AnyPackageManifest,
  type ManifestConnection,
  type ManifestProductProjection,
} from "./types";

const MAX_REPORTED_ERRORS = 5;

export type LoadManifestResult =
  | { ok: true; manifest: AnyPackageManifest }
  | {
      ok: false;
      error: "manifest_invalid" | "manifest_missing";
      details: string;
    };

/** Shape gate only — schema validation is the real check that follows. */
const isManifestShaped = (value: unknown): value is AnyPackageManifest =>
  typeof value === "object" && value !== null;

const invalid = (details: string) => {
  const result: LoadManifestResult = {
    details,
    error: "manifest_invalid",
    ok: false,
  };

  return result;
};

const missing = (details: string) => {
  const result: LoadManifestResult = {
    details,
    error: "manifest_missing",
    ok: false,
  };

  return result;
};

const integrationFailure = (manifest: AnyPackageManifest) => {
  const mode = manifest.integration?.mode;

  if (mode === "recipe" && manifest.wiring.length === 0)
    return 'integration mode "recipe" requires at least one wiring recipe';
  if (mode === "adapter" && (manifest.implements?.length ?? 0) === 0)
    return 'integration mode "adapter" requires at least one implementation';
  if (mode === "code-first" && manifest.wiring.length > 0)
    return 'integration mode "code-first" cannot declare automatic wiring recipes';

  return undefined;
};

const duplicateProductId = (product: ManifestProductProjection) =>
  (
    [
      ["blocks", product.blocks ?? []],
      ["connections", product.connections ?? []],
      ["dataSources", product.dataSources ?? []],
      ["events", product.events ?? []],
      ["healthChecks", product.healthChecks ?? []],
      ["releaseChecks", product.releaseChecks ?? []],
      ["workflowActions", product.workflowActions ?? []],
    ] satisfies ReadonlyArray<
      readonly [string, ReadonlyArray<{ id: string }>]
    >
  )
    .map(([group, entries]) => {
      const ids = new Set<string>();
      const duplicate = entries.find((entry) => {
        if (ids.has(entry.id)) return true;
        ids.add(entry.id);

        return false;
      });

      return duplicate
        ? `product.${group} contains duplicate id "${duplicate.id}"`
        : undefined;
    })
    .find((failure) => failure !== undefined);

const connectionFailure = (
  manifest: AnyPackageManifest,
  connection: ManifestConnection,
  toolReference: (
    reference: string | undefined,
    location: string,
    readOnly?: boolean,
  ) => string | undefined,
) => {
  const setupFailure = toolReference(
    connection.setupTool,
    `product.connections "${connection.id}" setup`,
  );
  if (setupFailure) return setupFailure;
  const testFailure = toolReference(
    connection.testTool,
    `product.connections "${connection.id}" test`,
    true,
  );
  if (testFailure) return testFailure;
  const declaredEnv = new Set(
    manifest.requires?.env?.map((entry) => entry.key),
  );
  const missingEnv = connection.envKeys?.find((key) => !declaredEnv.has(key));
  if (missingEnv)
    return `product.connections "${connection.id}" references undeclared env key "${missingEnv}"`;

  return undefined;
};

const productFailure = (manifest: AnyPackageManifest) => {
  if (!manifest.product) return undefined;
  if (manifest.contract !== 2)
    return "product projections require manifest contract 2";

  const tools = manifest.tools ?? {};
  const toolReference = (
    reference: string | undefined,
    location: string,
    readOnly = false,
  ) => {
    if (!reference) return undefined;
    const tool = tools[reference];
    if (!tool) return `${location} references missing tool "${reference}"`;
    if (!tool.authorization)
      return `${location} references legacy unguarded tool "${reference}"`;
    if (
      readOnly &&
      tool.authorization.effects.some((effect) => effect !== "read")
    )
      return `${location} must reference a read-only tool`;

    return undefined;
  };
  const duplicate = duplicateProductId(manifest.product);
  if (duplicate) return duplicate;

  const actionFailure = (manifest.product.workflowActions ?? [])
    .map((action) =>
      toolReference(
        action.tool,
        `product.workflowActions "${action.id}"`,
      ),
    )
    .find(Boolean);
  if (actionFailure) return actionFailure;
  const sourceFailure = (manifest.product.dataSources ?? [])
    .flatMap((source) =>
      Object.entries(source.tools ?? {}).map(([operation, tool]) =>
        toolReference(
          tool,
          `product.dataSources "${source.id}" operation "${operation}"`,
        ),
      ),
    )
    .find(Boolean);
  if (sourceFailure) return sourceFailure;
  const invalidConnection = (manifest.product.connections ?? [])
    .map((connection) =>
      connectionFailure(manifest, connection, toolReference),
    )
    .find(Boolean);
  if (invalidConnection) return invalidConnection;
  const healthIds = new Set(
    manifest.product.healthChecks?.map((check) => check.id),
  );
  const healthFailure = (manifest.product.healthChecks ?? [])
    .map((check) =>
      toolReference(
        check.tool,
        `product.healthChecks "${check.id}"`,
        true,
      ),
    )
    .find(Boolean);
  if (healthFailure) return healthFailure;
  const releaseFailure = (manifest.product.releaseChecks ?? [])
    .map((check) => {
      const missingHealth = check.healthCheckIds?.find(
        (id) => !healthIds.has(id),
      );

      return missingHealth
        ? `product.releaseChecks "${check.id}" references missing health check "${missingHealth}"`
        : undefined;
    })
    .find(Boolean);
  if (releaseFailure) return releaseFailure;

  return undefined;
};

const validate = (candidate: unknown, source: string) => {
  if (!isManifestShaped(candidate))
    return missing(`${source} did not export a manifest object`);

  const projected = serializeManifest(candidate);
  if (Value.Check(manifestSchema, projected)) {
    const invalidIntegration = integrationFailure(candidate);
    if (invalidIntegration) return invalid(invalidIntegration);
    const invalidProduct = productFailure(candidate);
    if (invalidProduct) return invalid(invalidProduct);
    if (
      candidate.contract === 1 &&
      Object.values(candidate.tools ?? {}).some(
        (tool) => tool.authorization !== undefined,
      )
    )
      return invalid(
        "tool authorization metadata requires manifest contract 2",
      );
    // TypeBox Record key patterns don't reject non-matching keys, so tool
    // names are enforced here — same rule the emit CLI applies.
    const badToolKey = Object.keys(candidate.tools ?? {}).find(
      (key) => !TOOL_NAME_PATTERN.test(key),
    );
    if (badToolKey !== undefined)
      return invalid(
        `tool key "${badToolKey}" must match ${TOOL_NAME_PATTERN} (snake_case, no dots — hosts namespace it)`,
      );
    const security = inspectManifestSecurity(candidate);
    const securityErrors = security.issues.filter(
      (issue) => issue.severity === "error",
    );
    if (securityErrors.length > 0)
      return invalid(
        securityErrors
          .slice(0, MAX_REPORTED_ERRORS)
          .map((issue) => `tool "${issue.toolName}": ${issue.message}`)
          .join("; "),
      );

    const result: LoadManifestResult = { manifest: candidate, ok: true };

    return result;
  }

  const details = [...Value.Errors(manifestSchema, projected)]
    .slice(0, MAX_REPORTED_ERRORS)
    .map((error) => `${error.path || "/"}: ${error.message}`)
    .join("; ");

  return invalid(details);
};

/** Dynamic-import a package's ./manifest subpath and validate it. `specifier`
 *  is normally the bare package name; pass a file URL (optionally with a
 *  cache-busting query) when loading from a specific node_modules tree.
 *  Never throws — callers surface a degraded status instead of crashing. */
export const loadManifest = async (specifier: string) => {
  let imported: unknown;
  try {
    imported = await import(
      specifier.includes("://") || specifier.endsWith("/manifest")
        ? specifier
        : `${specifier}/manifest`
    );
  } catch (error) {
    return missing(error instanceof Error ? error.message : String(error));
  }

  return validate(resolveManifestExport(imported), specifier);
};
/** Unwrap a module namespace ({ manifest } named export and/or default) or
 *  pass a bare manifest object through. */
export const resolveManifestExport = (moduleOrManifest: unknown) => {
  if (typeof moduleOrManifest !== "object" || moduleOrManifest === null)
    return moduleOrManifest;
  if ("contract" in moduleOrManifest) return moduleOrManifest;

  return (
    Reflect.get(moduleOrManifest, "manifest") ??
    Reflect.get(moduleOrManifest, "default")
  );
};
export const validateManifest = (candidate: unknown) =>
  validate(resolveManifestExport(candidate), "manifest");

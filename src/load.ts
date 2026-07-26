import { Value } from "@sinclair/typebox/value";
import { manifestSchema, serializeManifest } from "./schema";
import { inspectManifestSecurity } from "./security";
import { TOOL_NAME_PATTERN, type AnyPackageManifest } from "./types";

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

const validate = (candidate: unknown, source: string) => {
  if (!isManifestShaped(candidate))
    return missing(`${source} did not export a manifest object`);

  const projected = serializeManifest(candidate);
  if (Value.Check(manifestSchema, projected)) {
    const invalidIntegration = integrationFailure(candidate);
    if (invalidIntegration) return invalid(invalidIntegration);
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

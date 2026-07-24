#!/usr/bin/env bun
/* absolute-manifest — build-time companion for manifest-bearing packages.
 *
 *   absolute-manifest emit [entry]     Validate the package's manifest and
 *                                      write dist/manifest.json (handlers
 *                                      stripped). Default entry: resolves
 *                                      ./src/manifest.ts, then ./dist/manifest.js.
 *   absolute-manifest scaffold         Generate a starter src/manifest.ts
 *                                      from the package.json in cwd.
 *   absolute-manifest verify-package   Validate shared-runtime ownership in
 *                                      package.json without emitting a manifest.
 *   absolute-manifest verify-tree      Recursively validate package policies.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Value } from "@sinclair/typebox/value";
import { resolveManifestExport, validateManifest } from "./load";
import {
  validatePackageArtifactPolicy,
  validatePackageRuntimePolicy,
} from "./packagePolicy";
import { serializeManifest } from "./schema";
import { TOOL_NAME_PATTERN } from "./types";

const TAGLINE_MAX_LENGTH = 80;
const IGNORED_PACKAGE_DIRECTORIES = new Set([
  ".git",
  ".test-shards",
  "build",
  "dist",
  "node_modules",
]);

type PackageTreeScan = { packagePaths: string[]; skippedDirectories: string[] };

class CliError extends Error {}

type PackageJsonShape = {
  name?: string;
  description?: string;
  absolutejs?: { manifestContract?: number; runtimePeers?: unknown };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  exports?: Record<string, unknown>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  scripts?: Record<string, string>;
};

const readPackageJson = async (dir: string) => {
  const path = join(dir, "package.json");
  if (!existsSync(path)) throw new CliError(`no package.json in ${dir}`);
  const parsed: PackageJsonShape = JSON.parse(await readFile(path, "utf8"));

  return parsed;
};

const readBuiltJavaScript = async (directory: string) => {
  const glob = new Bun.Glob("dist/**/*.js");
  const relativePaths = await Array.fromAsync(
    glob.scan({ cwd: directory, onlyFiles: true }),
  );
  const entries = await Promise.all(
    relativePaths.map(async (relativePath) => [
      relativePath,
      await readFile(join(directory, relativePath), "utf8"),
    ]),
  );

  return Object.fromEntries(entries);
};

const validatePackageAt = async (directory: string, artifacts: boolean) => {
  const packageJson = await readPackageJson(directory);
  if (!artifacts) return validatePackageRuntimePolicy(packageJson);
  const builtJavaScript = await readBuiltJavaScript(directory);

  return validatePackageArtifactPolicy(packageJson, builtJavaScript);
};

const resolveEntry = (cwd: string, explicit?: string) => {
  if (explicit !== undefined) {
    const path = resolve(cwd, explicit);
    if (!existsSync(path)) throw new CliError(`entry not found: ${path}`);

    return path;
  }
  const candidates = [
    join(cwd, "src/manifest.ts"),
    join(cwd, "dist/manifest.js"),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found === undefined)
    throw new CliError(
      "no src/manifest.ts or dist/manifest.js found — pass an entry path",
    );

  return found;
};

const emit = async (explicitEntry?: string) => {
  const cwd = process.cwd();
  const packageJson = await readPackageJson(cwd);
  const entry = resolveEntry(cwd, explicitEntry);

  const imported: unknown = await import(pathToFileURL(entry).href);
  const candidate = resolveManifestExport(imported);
  const result = validateManifest(candidate);
  if (!result.ok) throw new CliError(`${result.error}: ${result.details}`);

  const { manifest } = result;
  const problems: string[] = [];
  const packagePolicy = validatePackageRuntimePolicy(packageJson);
  if (!packagePolicy.ok)
    problems.push(...packagePolicy.issues.map(({ message }) => message));

  if (
    packageJson.name !== undefined &&
    manifest.identity.name !== packageJson.name
  )
    problems.push(
      `identity.name "${manifest.identity.name}" does not match package.json name "${packageJson.name}"`,
    );

  if (packageJson.absolutejs?.manifestContract !== manifest.contract)
    problems.push(
      `package.json "absolutejs".manifestContract must equal ${manifest.contract} (found ${packageJson.absolutejs?.manifestContract})`,
    );

  for (const toolName of Object.keys(manifest.tools ?? {}))
    if (!TOOL_NAME_PATTERN.test(toolName))
      problems.push(
        `tool key "${toolName}" must match ${TOOL_NAME_PATTERN} (snake_case, no dots — hosts namespace it)`,
      );

  for (const preset of manifest.presets ?? [])
    if (!Value.Check(manifest.settings, preset.values))
      problems.push(
        `preset "${preset.id}" values do not satisfy the settings schema`,
      );

  const settingsProperties: Record<string, { title?: string }> =
    Reflect.get(manifest.settings, "properties") ?? {};
  for (const [field, fieldSchema] of Object.entries(settingsProperties))
    if (fieldSchema.title === undefined)
      console.warn(
        `absolute-manifest: warning — settings field "${field}" has no title; no-code UIs will fall back to the raw key`,
      );

  if (problems.length > 0) throw new CliError(problems.join("\n  "));

  const outDir = join(cwd, "dist");
  const artifactPolicy = await validatePackageAt(cwd, true);
  if (!artifactPolicy.ok)
    throw new CliError(
      artifactPolicy.issues.map(({ message }) => message).join("\n  "),
    );
  await mkdir(outDir, { recursive: true });
  const outPath = join(outDir, "manifest.json");
  await writeFile(
    outPath,
    `${JSON.stringify(serializeManifest(manifest), null, "\t")}\n`,
  );
  console.log(`absolute-manifest: wrote ${outPath}`);
};

const verifyPackage = async (
  explicitDirectory: string | undefined,
  artifacts: boolean,
) => {
  const directory = resolve(process.cwd(), explicitDirectory ?? ".");
  const result = await validatePackageAt(directory, artifacts);
  if (!result.ok)
    throw new CliError(
      result.issues.map(({ message }) => message).join("\n  "),
    );
  console.log(`absolute-manifest: package policy valid in ${directory}`);
};

const packagePathIsInspectable = (relativePath: string) =>
  !relativePath
    .split("/")
    .some((segment) => IGNORED_PACKAGE_DIRECTORIES.has(segment));

const scanPackageTree = async (
  root: string,
  directory = root,
): Promise<PackageTreeScan> => {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? Reflect.get(error, "code")
        : undefined;
    if (code === "EACCES" || code === "EPERM")
      return { packagePaths: [], skippedDirectories: [directory] };
    throw error;
  }

  const packagePaths: string[] = [];
  const skippedDirectories: string[] = [];
  if (entries.some((entry) => entry.isFile() && entry.name === "package.json"))
    packagePaths.push(join(directory, "package.json"));
  const childScans = await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isDirectory() && !IGNORED_PACKAGE_DIRECTORIES.has(entry.name),
      )
      .map((entry) => scanPackageTree(root, join(directory, entry.name))),
  );

  for (const child of childScans) {
    packagePaths.push(...child.packagePaths);
    skippedDirectories.push(...child.skippedDirectories);
  }

  return { packagePaths, skippedDirectories };
};

const verifyTree = async (
  explicitDirectory: string | undefined,
  artifacts: boolean,
) => {
  const root = resolve(process.cwd(), explicitDirectory ?? ".");
  const scanned = await scanPackageTree(root);
  const packagePaths = scanned.packagePaths
    .map((packagePath) => packagePath.slice(root.length + 1))
    .filter(packagePathIsInspectable);
  const results = await Promise.all(
    packagePaths.map(async (packagePath) => {
      const directory = resolve(root, packagePath, "..");
      const result = await validatePackageAt(directory, artifacts);

      return { packagePath, result };
    }),
  );
  const problems = results.flatMap(({ packagePath, result }) =>
    result.ok
      ? []
      : result.issues.map(({ message }) => `${packagePath}: ${message}`),
  );
  if (problems.length > 0) throw new CliError(problems.join("\n  "));
  for (const directory of scanned.skippedDirectories)
    console.warn(
      `absolute-manifest: warning — skipped unreadable directory ${directory}`,
    );
  console.log(
    `absolute-manifest: ${packagePaths.length} package policies valid in ${root}`,
  );
};

const scaffoldTemplate = (
  name: string,
  description: string,
) => `import { Type } from '@sinclair/typebox';
import { defineManifest } from '@absolutejs/manifest';

// TODO: replace TConfig with this package's real exported options type so the
// settings schema below is checked against it on every build.
type TConfig = Record<never, never>;

export const manifest = defineManifest<TConfig>()({
	contract: 2,
	identity: {
		category: 'infrastructure', // TODO: pick the right category id
		name: '${name}',
		tagline: '${description.replaceAll("'", "\\'").slice(0, TAGLINE_MAX_LENGTH)}' // TODO: one plain-language sentence for site owners
	},
	settings: Type.Object({}),
	wiring: [
		{
			id: 'default',
			server: {
				code: '// TODO: wiring snippet using \${settings} / \${env.KEY} / \${slot.name}',
				imports: [],
				placement: 'module-scope'
			},
			title: 'Default setup'
		}
	]
});
`;

const scaffold = async () => {
  const cwd = process.cwd();
  const packageJson = await readPackageJson(cwd);
  const target = join(cwd, "src/manifest.ts");
  if (existsSync(target)) throw new CliError(`${target} already exists`);
  await mkdir(join(cwd, "src"), { recursive: true });
  await writeFile(
    target,
    scaffoldTemplate(
      packageJson.name ?? "unnamed",
      packageJson.description ?? "",
    ),
  );
  console.log(`absolute-manifest: wrote ${target}`);
  console.log(
    'next steps: 1) set TConfig to the real options type  2) add "./manifest" to exports  3) add "absolutejs": { "manifestContract": 2 }  4) declare authorization on every tool  5) run absolute-manifest emit in the build',
  );
};

const run = async () => {
  const [, , command, ...rest] = process.argv;
  const artifacts = rest.includes("--artifacts");
  const directory = rest.find((argument) => argument !== "--artifacts");
  if (command === "emit") await emit(rest[0]);
  else if (command === "scaffold") await scaffold();
  else if (command === "verify-package")
    await verifyPackage(directory, artifacts);
  else if (command === "verify-tree") await verifyTree(directory, artifacts);
  else
    throw new CliError(
      `unknown command "${command ?? ""}" — use: emit [entry] | scaffold | verify-package [directory] [--artifacts] | verify-tree [directory] [--artifacts]`,
    );
};

try {
  await run();
} catch (error) {
  console.error(
    `absolute-manifest: ${error instanceof CliError ? error.message : String(error)}`,
  );
  process.exit(1);
}

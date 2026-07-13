#!/usr/bin/env bun
/* absolute-manifest — build-time companion for manifest-bearing packages.
 *
 *   absolute-manifest emit [entry]     Validate the package's manifest and
 *                                      write dist/manifest.json (handlers
 *                                      stripped). Default entry: resolves
 *                                      ./src/manifest.ts, then ./dist/manifest.js.
 *   absolute-manifest scaffold         Generate a starter src/manifest.ts
 *                                      from the package.json in cwd.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Value } from '@sinclair/typebox/value';
import { resolveManifestExport, validateManifest } from './load';
import { serializeManifest } from './schema';
import type { AnyPackageManifest } from './types';
import { TOOL_NAME_PATTERN } from './types';

const fail = (message: string): never => {
	console.error(`absolute-manifest: ${message}`);
	process.exit(1);
};

const readPackageJson = async (dir: string) => {
	const path = join(dir, 'package.json');
	if (!existsSync(path)) fail(`no package.json in ${dir}`);

	return JSON.parse(await readFile(path, 'utf8')) as {
		name?: string;
		description?: string;
		absolutejs?: { manifestContract?: number };
		exports?: Record<string, unknown>;
	};
};

const resolveEntry = (cwd: string, explicit?: string): string => {
	if (explicit !== undefined) {
		const path = resolve(cwd, explicit);
		if (!existsSync(path)) fail(`entry not found: ${path}`);

		return path;
	}
	const candidates = [join(cwd, 'src/manifest.ts'), join(cwd, 'dist/manifest.js')];
	const found = candidates.find((candidate) => existsSync(candidate));
	if (found === undefined)
		fail('no src/manifest.ts or dist/manifest.js found — pass an entry path');

	return found as string;
};

const emit = async (explicitEntry?: string) => {
	const cwd = process.cwd();
	const packageJson = await readPackageJson(cwd);
	const entry = resolveEntry(cwd, explicitEntry);

	const imported = await import(pathToFileURL(entry).href);
	const candidate = resolveManifestExport(imported);
	const result = validateManifest(candidate);
	if (!result.ok) fail(`${result.error}: ${result.details}`);

	const manifest = (result as { manifest: AnyPackageManifest }).manifest;
	const problems: string[] = [];

	if (packageJson.name !== undefined && manifest.identity.name !== packageJson.name)
		problems.push(
			`identity.name "${manifest.identity.name}" does not match package.json name "${packageJson.name}"`
		);

	if (packageJson.absolutejs?.manifestContract !== manifest.contract)
		problems.push(
			`package.json "absolutejs".manifestContract must equal ${manifest.contract} (found ${packageJson.absolutejs?.manifestContract})`
		);

	for (const toolName of Object.keys(manifest.tools ?? {}))
		if (!TOOL_NAME_PATTERN.test(toolName))
			problems.push(
				`tool key "${toolName}" must match ${TOOL_NAME_PATTERN} (snake_case, no dots — hosts namespace it)`
			);

	const settingsSchema = manifest.settings as Parameters<typeof Value.Check>[0];
	for (const preset of manifest.presets ?? [])
		if (!Value.Check(settingsSchema, preset.values))
			problems.push(`preset "${preset.id}" values do not satisfy the settings schema`);

	const settingsProperties =
		(manifest.settings as { properties?: Record<string, { title?: string }> })
			.properties ?? {};
	for (const [field, fieldSchema] of Object.entries(settingsProperties))
		if (fieldSchema.title === undefined)
			console.warn(
				`absolute-manifest: warning — settings field "${field}" has no title; no-code UIs will fall back to the raw key`
			);

	if (problems.length > 0) fail(problems.join('\n  '));

	const outDir = join(cwd, 'dist');
	await mkdir(outDir, { recursive: true });
	const outPath = join(outDir, 'manifest.json');
	await writeFile(outPath, `${JSON.stringify(serializeManifest(manifest), null, '\t')}\n`);
	console.log(`absolute-manifest: wrote ${outPath}`);
};

const SCAFFOLD_TEMPLATE = (name: string, description: string) => `import { Type } from '@sinclair/typebox';
import { defineManifest } from '@absolutejs/manifest';

// TODO: replace TConfig with this package's real exported options type so the
// settings schema below is checked against it on every build.
type TConfig = Record<never, never>;

export const manifest = defineManifest<TConfig>()({
	contract: 1,
	identity: {
		category: 'infrastructure', // TODO: pick the right category id
		name: '${name}',
		tagline: '${description.replaceAll("'", "\\'").slice(0, 80)}' // TODO: one plain-language sentence for site owners
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

export default manifest;
`;

const scaffold = async () => {
	const cwd = process.cwd();
	const packageJson = await readPackageJson(cwd);
	const target = join(cwd, 'src/manifest.ts');
	if (existsSync(target)) fail(`${target} already exists`);
	await mkdir(join(cwd, 'src'), { recursive: true });
	await writeFile(
		target,
		SCAFFOLD_TEMPLATE(packageJson.name ?? 'unnamed', packageJson.description ?? '')
	);
	console.log(`absolute-manifest: wrote ${target}`);
	console.log(
		'next steps: 1) set TConfig to the real options type  2) add "./manifest" to exports  3) add "absolutejs": { "manifestContract": 1 }  4) run absolute-manifest emit in the build'
	);
};

const [, , command, ...rest] = process.argv;
if (command === 'emit') await emit(rest[0]);
else if (command === 'scaffold') await scaffold();
else fail(`unknown command "${command ?? ''}" — use: emit [entry] | scaffold`);

import { Value } from '@sinclair/typebox/value';
import { manifestSchema, serializeManifest } from './schema';
import type { AnyPackageManifest } from './types';
import { TOOL_NAME_PATTERN } from './types';

const MAX_REPORTED_ERRORS = 5;

export type LoadManifestResult =
	| { ok: true; manifest: AnyPackageManifest }
	| { ok: false; error: 'manifest_invalid' | 'manifest_missing'; details: string };

const validate = (
	candidate: unknown,
	source: string
): LoadManifestResult => {
	if (candidate === null || typeof candidate !== 'object')
		return {
			details: `${source} did not export a manifest object`,
			error: 'manifest_missing',
			ok: false
		};

	const projected = serializeManifest(candidate as AnyPackageManifest);
	if (Value.Check(manifestSchema, projected)) {
		// TypeBox Record key patterns don't reject non-matching keys, so tool
		// names are enforced here — same rule the emit CLI applies.
		const badToolKey = Object.keys(
			(candidate as AnyPackageManifest).tools ?? {}
		).find((key) => !TOOL_NAME_PATTERN.test(key));
		if (badToolKey !== undefined)
			return {
				details: `tool key "${badToolKey}" must match ${TOOL_NAME_PATTERN} (snake_case, no dots — hosts namespace it)`,
				error: 'manifest_invalid',
				ok: false
			};

		return { manifest: candidate as AnyPackageManifest, ok: true };
	}

	const details = [...Value.Errors(manifestSchema, projected)]
		.slice(0, MAX_REPORTED_ERRORS)
		.map((error) => `${error.path || '/'}: ${error.message}`)
		.join('; ');

	return { details, error: 'manifest_invalid', ok: false };
};

/** Validate an already-imported manifest module (`import('<pkg>/manifest')`).
 *  Accepts either the module namespace ({ manifest } named export and/or
 *  default) or the manifest object itself. Never throws — callers surface a
 *  degraded status instead of crashing. */
export const resolveManifestExport = (moduleOrManifest: unknown): unknown => {
	if (moduleOrManifest === null || typeof moduleOrManifest !== 'object')
		return moduleOrManifest;
	const record = moduleOrManifest as Record<string, unknown>;
	if ('contract' in record) return record;

	return record.manifest ?? record.default;
};

/** Dynamic-import a package's ./manifest subpath and validate it. `specifier`
 *  is normally the bare package name; pass a file URL (optionally with a
 *  cache-busting query) when loading from a specific node_modules tree. */
export const loadManifest = async (
	specifier: string
): Promise<LoadManifestResult> => {
	let imported: unknown;
	try {
		imported = await import(
			specifier.includes('://') || specifier.endsWith('/manifest')
				? specifier
				: `${specifier}/manifest`
		);
	} catch (error) {
		return {
			details:
				error instanceof Error ? error.message : String(error),
			error: 'manifest_missing',
			ok: false
		};
	}

	return validate(resolveManifestExport(imported), specifier);
};

/** Validate a manifest object you already hold (no import). */
export const validateManifest = (candidate: unknown): LoadManifestResult =>
	validate(resolveManifestExport(candidate), 'manifest');

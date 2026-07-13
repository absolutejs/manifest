import { Type } from '@sinclair/typebox';
import type { AnyPackageManifest } from './types';
import { TOOL_NAME_PATTERN } from './types';

/* The manifest's own TypeBox schema — the contract dogfooding itself.
 * It describes the SERIALIZABLE projection of a manifest (tool handlers
 * stripped): exactly what `absolute-manifest emit` writes to manifest.json
 * and what `loadManifest` validates after projecting an imported module.
 */

const envRequirement = Type.Object({
	description: Type.String(),
	docsUrl: Type.Optional(Type.String()),
	example: Type.Optional(Type.String()),
	key: Type.String({ pattern: '^[A-Z][A-Z0-9_]*$' }),
	optional: Type.Optional(Type.Boolean()),
	secret: Type.Optional(Type.Boolean()),
	when: Type.Optional(Type.String())
});

const wiringImport = Type.Object({
	from: Type.String(),
	names: Type.Array(Type.String()),
	typeOnly: Type.Optional(Type.Boolean())
});

const wiringSnippet = Type.Object({
	code: Type.String(),
	imports: Type.Array(wiringImport),
	placement: Type.Optional(
		Type.Union([
			Type.Literal('client-entry'),
			Type.Literal('module-scope'),
			Type.Literal('server-factory'),
			Type.Literal('server-plugin')
		])
	)
});

const clientFrameworks = ['angular', 'client', 'react', 'svelte', 'vue'] as const;

const wiringRecipe = Type.Object({
	client: Type.Optional(
		Type.Partial(
			Type.Object(
				Object.fromEntries(
					clientFrameworks.map((framework) => [framework, wiringSnippet])
				)
			)
		)
	),
	description: Type.Optional(Type.String()),
	id: Type.String({ minLength: 1 }),
	server: Type.Optional(wiringSnippet),
	title: Type.String()
});

const adapterSlot = Type.Object({
	configPath: Type.String({ minLength: 1 }),
	contract: Type.String({ pattern: '^[a-z0-9-]+/[a-z0-9-]+$' }),
	description: Type.String(),
	known: Type.Optional(Type.Array(Type.String())),
	required: Type.Optional(Type.Boolean())
});

/** Any JSON-Schema-shaped object (a TypeBox schema at rest is plain JSON). */
const jsonSchemaObject = Type.Record(Type.String(), Type.Unknown());

const adapterImplementation = Type.Object({
	contract: Type.String({ pattern: '^[a-z0-9-]+/[a-z0-9-]+$' }),
	env: Type.Optional(Type.Array(envRequirement)),
	factory: Type.String({ minLength: 1 }),
	from: Type.String({ minLength: 1 }),
	settings: Type.Optional(jsonSchemaObject),
	title: Type.String(),
	wiring: wiringSnippet
});

const lifecycleStep = Type.Object({
	command: Type.Optional(Type.String()),
	docsUrl: Type.Optional(Type.String()),
	id: Type.String({ minLength: 1 }),
	idempotent: Type.Optional(Type.Boolean()),
	kind: Type.Union([
		Type.Literal('migration'),
		Type.Literal('post-install'),
		Type.Literal('verify')
	]),
	title: Type.String(),
	when: Type.Union([
		Type.Literal('after-install'),
		Type.Literal('after-upgrade'),
		Type.Literal('before-first-run'),
		Type.Literal('manual')
	])
});

const toolAnnotations = Type.Object({
	destructiveHint: Type.Optional(Type.Boolean()),
	idempotentHint: Type.Optional(Type.Boolean()),
	openWorldHint: Type.Optional(Type.Boolean()),
	readOnlyHint: Type.Optional(Type.Boolean()),
	title: Type.Optional(Type.String())
});

const serializedTool = Type.Object({
	annotations: Type.Optional(toolAnnotations),
	capabilities: Type.Optional(
		Type.Array(
			Type.Union([
				Type.Literal('exec'),
				Type.Literal('glob'),
				Type.Literal('read'),
				Type.Literal('write')
			])
		)
	),
	description: Type.String(),
	input: jsonSchemaObject,
	kind: Type.Union([Type.Literal('runtime'), Type.Literal('workspace')])
});

export const manifestSchema = Type.Object({
	contract: Type.Literal(1),
	identity: Type.Object({
		accent: Type.Optional(Type.String({ pattern: '^#[0-9a-fA-F]{3,8}$' })),
		category: Type.String({ minLength: 1 }),
		description: Type.Optional(Type.String()),
		docsUrl: Type.Optional(Type.String()),
		logo: Type.Optional(
			Type.Object({
				svg: Type.Optional(Type.String()),
				url: Type.Optional(Type.String())
			})
		),
		name: Type.String({ pattern: '^(@[a-z0-9-~][a-z0-9-._~]*/)?[a-z0-9-~][a-z0-9-._~]*$' }),
		tagline: Type.String({ minLength: 1 })
	}),
	implements: Type.Optional(Type.Array(adapterImplementation)),
	lifecycle: Type.Optional(Type.Array(lifecycleStep)),
	presets: Type.Optional(
		Type.Array(
			Type.Object({
				description: Type.Optional(Type.String()),
				id: Type.String({ minLength: 1 }),
				title: Type.String(),
				values: Type.Record(Type.String(), Type.Unknown())
			})
		)
	),
	requires: Type.Optional(
		Type.Object({
			env: Type.Optional(Type.Array(envRequirement)),
			peers: Type.Optional(
				Type.Array(
					Type.Object({
						name: Type.String(),
						range: Type.String(),
						reason: Type.Optional(Type.String())
					})
				)
			),
			services: Type.Optional(
				Type.Array(
					Type.Object({
						description: Type.String(),
						id: Type.String(),
						optional: Type.Optional(Type.Boolean())
					})
				)
			)
		})
	),
	settings: jsonSchemaObject,
	slots: Type.Optional(Type.Record(Type.String(), adapterSlot)),
	tools: Type.Optional(
		Type.Record(Type.String({ pattern: TOOL_NAME_PATTERN.source }), serializedTool)
	),
	wiring: Type.Array(wiringRecipe)
});

/** Serializable projection of a manifest: tool handlers stripped, everything
 *  else passed through. Used by the emit CLI and by loadManifest validation —
 *  one projection so the two can never diverge. */
export const serializeManifest = (
	manifest: AnyPackageManifest
): Record<string, unknown> => {
	const { __config, tools, ...rest } = manifest;
	void __config;

	return {
		...rest,
		...(tools === undefined
			? {}
			: {
					tools: Object.fromEntries(
						Object.entries(tools).map(([name, tool]) => [
							name,
							{
								...(tool.annotations === undefined
									? {}
									: { annotations: tool.annotations }),
								...(tool.kind === 'workspace'
									? { capabilities: tool.capabilities }
									: {}),
								description: tool.description,
								input: tool.input,
								kind: tool.kind
							}
						])
					)
				})
	};
};

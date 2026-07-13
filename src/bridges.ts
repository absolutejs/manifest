import { Value } from '@sinclair/typebox/value';
import type {
	AnyPackageManifest,
	BridgedAITool,
	BridgedMcpTool,
	ManifestTool,
	PackageManifest,
	ToolBindings,
	Workspace
} from './types';

const MAX_REPORTED_ERRORS = 3;

/** Validate + default the raw args against the tool's schema. Returns the
 *  cleaned value, or an error string the AI/MCP caller can act on. Handlers
 *  never see unvalidated input. */
const checkInput = (
	toolName: string,
	schema: ManifestTool<unknown>['input'],
	args: unknown
): { ok: true; value: unknown } | { ok: false; message: string } => {
	const withDefaults = Value.Default(schema, Value.Clone(args ?? {}));
	if (Value.Check(schema, withDefaults))
		return { ok: true, value: withDefaults };
	const errors = [...Value.Errors(schema, withDefaults)]
		.slice(0, MAX_REPORTED_ERRORS)
		.map((error) => `${error.path || '/'}: ${error.message}`)
		.join('; ');

	return {
		message: `Invalid input for tool "${toolName}": ${errors}`,
		ok: false
	};
};

const hasCapabilities = (
	tool: ManifestTool<unknown>,
	workspace: Workspace | undefined
): workspace is Workspace => {
	if (tool.kind !== 'workspace') return false;
	if (workspace === undefined) return false;

	return tool.capabilities.every((capability) =>
		capability === 'read' ? true : workspace[capability] !== undefined
	);
};

type BoundTool = {
	name: string;
	description: string;
	input: Record<string, unknown>;
	annotations?: ManifestTool<unknown>['annotations'];
	invoke: (args: unknown) => Promise<string> | string;
};

/** Shared binding logic. Fails closed: a runtime tool without a runtime
 *  binding, or a workspace tool missing a granted capability, is OMITTED —
 *  registries list only callable tools. */
const bindTools = <TRuntime>(
	manifest: PackageManifest<never, TRuntime> | AnyPackageManifest,
	bindings: ToolBindings<TRuntime>
): ReadonlyArray<BoundTool> =>
	Object.entries(manifest.tools ?? {}).flatMap(([name, tool]) => {
		const typed = tool as ManifestTool<TRuntime>;
		const runnable =
			typed.kind === 'runtime'
				? bindings.runtime !== undefined
				: hasCapabilities(typed, bindings.workspace);
		if (!runnable) return [];

		const invoke = (args: unknown) => {
			const checked = checkInput(name, typed.input, args);
			if (!checked.ok) return checked.message;

			return typed.kind === 'runtime'
				? typed.handler(checked.value, bindings.runtime as TRuntime)
				: typed.handler(checked.value, bindings.workspace as Workspace);
		};

		return [
			{
				annotations: typed.annotations,
				description: typed.description,
				input: typed.input as unknown as Record<string, unknown>,
				invoke,
				name
			}
		];
	});

/** Structurally satisfies @absolutejs/ai's AIToolMap — drop the result into
 *  `streamAIToSSE({ tools })`. Consumers running untrusted manifests should
 *  compose with that package's `hardenUntrustedTool`. */
export const toAIToolMap = <TRuntime>(
	manifest: PackageManifest<never, TRuntime> | AnyPackageManifest,
	bindings: ToolBindings<TRuntime>
): Record<string, BridgedAITool> =>
	Object.fromEntries(
		bindTools(manifest, bindings).map((tool) => [
			tool.name,
			{
				annotations: tool.annotations,
				description: tool.description,
				handler: tool.invoke,
				input: tool.input
			}
		])
	);

/** Structurally satisfies @absolutejs/mcp's McpToolRegistry — usable as the
 *  `tools` of an mcpServer config. */
export const toMcpToolRegistry = <TRuntime>(
	manifest: PackageManifest<never, TRuntime> | AnyPackageManifest,
	bindings: ToolBindings<TRuntime>
): Record<string, BridgedMcpTool> =>
	Object.fromEntries(
		bindTools(manifest, bindings).map((tool) => [
			tool.name,
			{
				annotations: tool.annotations,
				description: tool.description,
				handler: tool.invoke,
				inputSchema: tool.input
			}
		])
	);

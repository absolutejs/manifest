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

type CheckedInput =
	| { ok: true; value: unknown }
	| { ok: false; message: string };

/** Validate + default the raw args against the tool's schema. Returns the
 *  cleaned value, or an error string the AI/MCP caller can act on. Handlers
 *  never see unvalidated input. */
const checkInput = (
	toolName: string,
	schema: ManifestTool<unknown>['input'],
	args: unknown
) => {
	const withDefaults = Value.Default(schema, Value.Clone(args ?? {}));
	if (Value.Check(schema, withDefaults)) {
		const passed: CheckedInput = { ok: true, value: withDefaults };

		return passed;
	}
	const errors = [...Value.Errors(schema, withDefaults)]
		.slice(0, MAX_REPORTED_ERRORS)
		.map((error) => `${error.path || '/'}: ${error.message}`)
		.join('; ');
	const failed: CheckedInput = {
		message: `Invalid input for tool "${toolName}": ${errors}`,
		ok: false
	};

	return failed;
};

const grantsCapabilities = (
	capabilities: ReadonlyArray<'exec' | 'glob' | 'read' | 'write'>,
	workspace: Workspace
) =>
	capabilities.every(
		(capability) =>
			capability === 'read' || workspace[capability] !== undefined
	);

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
) => {
	const { runtime, workspace } = bindings;

	const bindInvoke = (name: string, tool: ManifestTool<TRuntime>) => {
		if (tool.kind === 'runtime') {
			if (runtime === undefined) return undefined;

			return (args: unknown) => {
				const checked = checkInput(name, tool.input, args);

				return checked.ok
					? tool.handler(checked.value, runtime)
					: checked.message;
			};
		}
		if (
			workspace === undefined ||
			!grantsCapabilities(tool.capabilities, workspace)
		)
			return undefined;

		return (args: unknown) => {
			const checked = checkInput(name, tool.input, args);

			return checked.ok
				? tool.handler(checked.value, workspace)
				: checked.message;
		};
	};

	return Object.entries(manifest.tools ?? {}).flatMap(([name, tool]) => {
		const invoke = bindInvoke(name, tool);
		if (invoke === undefined) return [];

		const bound: BoundTool = {
			annotations: tool.annotations,
			description: tool.description,
			input: tool.input,
			invoke,
			name
		};

		return [bound];
	});
};

/** Structurally satisfies @absolutejs/ai's AIToolMap — drop the result into
 *  `streamAIToSSE({ tools })`. Consumers running untrusted manifests should
 *  compose with that package's `hardenUntrustedTool`. */
export const toAIToolMap = <TRuntime>(
	manifest: PackageManifest<never, TRuntime> | AnyPackageManifest,
	bindings: ToolBindings<TRuntime>
) => {
	const tools: Record<string, BridgedAITool> = Object.fromEntries(
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

	return tools;
};

/** Structurally satisfies @absolutejs/mcp's McpToolRegistry — usable as the
 *  `tools` of an mcpServer config. */
export const toMcpToolRegistry = <TRuntime>(
	manifest: PackageManifest<never, TRuntime> | AnyPackageManifest,
	bindings: ToolBindings<TRuntime>
) => {
	const tools: Record<string, BridgedMcpTool> = Object.fromEntries(
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

	return tools;
};

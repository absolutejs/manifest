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
	authorization?: ManifestTool<unknown>['authorization'];
	invoke: (args: unknown) => Promise<string> | string;
};

/** Shared binding logic. Fails closed: a runtime tool without a runtime
 *  binding, or a workspace tool missing a granted capability, is OMITTED —
 *  registries list only callable tools. */
const bindTools = <TRuntime>(
	manifest: PackageManifest<never, TRuntime> | AnyPackageManifest,
	bindings: ToolBindings<TRuntime>
) => {
	const { authorize, runtime, workspace } = bindings;

	const authorizeInvocation = async (
		name: string,
		tool: ManifestTool<TRuntime>,
		args: unknown,
		invoke: (args: unknown) => Promise<string> | string
	) => {
		const checked = checkInput(name, tool.input, args);
		if (!checked.ok) return checked.message;
		if (tool.authorization === undefined) return invoke(checked.value);
		if (authorize === undefined) return 'Tool authorization is not configured';
		const result = await authorize({
			args: checked.value,
			authorization: tool.authorization,
			toolName: name
		});

		return result.allowed ? invoke(checked.value) : result.message;
	};

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
		if (tool.authorization !== undefined && authorize === undefined) return [];
		const invoke = bindInvoke(name, tool);
		if (invoke === undefined) return [];

		const bound: BoundTool = {
			annotations: tool.annotations,
			authorization: tool.authorization,
			description: tool.description,
			input: tool.input,
			name,
			invoke: (args) => authorizeInvocation(name, tool, args, invoke)
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
				authorization: tool.authorization,
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
				authorization: tool.authorization,
				...('x-coaz-mapping' in tool.input ? { coaz: true as const } : {}),
				description: tool.description,
				handler: tool.invoke,
				inputSchema: tool.input
			}
		])
	);

	return tools;
};

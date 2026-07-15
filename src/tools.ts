import type { Static, TSchema } from '@sinclair/typebox';
import type {
	RuntimeTool,
	ToolAnnotations,
	ToolAuthorization,
	Workspace,
	WorkspaceCapability,
	WorkspaceTool
} from './types';

/** Per-tool generic inference: the input schema types the handler's first
 *  parameter (`Static<S>`); TRuntime is fixed once by the curried factory.
 *  The schema is the ONLY schema — it feeds AI providers and MCP verbatim at
 *  runtime and the handler signature at compile time.
 *
 *  ```ts
 *  const tool = toolFactory<Dispatcher>();
 *
 *  tool.runtime({
 *  	description: 'Send a transactional email through the configured adapter.',
 *  	input: Type.Object({ to: Type.String({ format: 'email' }), subject: Type.String(), text: Type.String() }),
 *  	annotations: { openWorldHint: true },
 *  	handler: async (input, dispatcher) => {
 *  		const result = await dispatcher.email(input); // input fully typed
 *  		return `sent via ${result.provider}`;
 *  	}
 *  });
 *  ```
 */
export const toolFactory = <TRuntime>() => ({
	runtime: <S extends TSchema>(definition: {
		description: string;
		input: S;
		annotations?: ToolAnnotations;
		authorization?: ToolAuthorization;
		handler: (
			input: Static<S>,
			runtime: TRuntime
		) => Promise<string> | string;
	}): RuntimeTool<TRuntime> =>
		({ kind: 'runtime', ...definition }),

	workspace: <S extends TSchema>(definition: {
		description: string;
		input: S;
		annotations?: ToolAnnotations;
		authorization?: ToolAuthorization;
		capabilities: ReadonlyArray<WorkspaceCapability>;
		handler: (
			input: Static<S>,
			workspace: Workspace
		) => Promise<string> | string;
	}): WorkspaceTool => ({ kind: 'workspace', ...definition })
});

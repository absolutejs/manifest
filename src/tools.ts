import type { Static, TSchema } from "@sinclair/typebox";
import type {
  AuthorizedRuntimeTool,
  AuthorizedWorkspaceTool,
  LegacyRuntimeTool,
  LegacyWorkspaceTool,
  ToolAnnotations,
  ToolAuthorization,
  Workspace,
  WorkspaceCapability,
} from "./types";

const literal = <Value extends string>(value: Value) => value;
const RUNTIME_KIND = literal("runtime");
const WORKSPACE_KIND = literal("workspace");

type RuntimeToolDefinition<S extends TSchema, TRuntime> = {
  description: string;
  input: S;
  annotations?: ToolAnnotations;
  handler: (input: Static<S>, runtime: TRuntime) => Promise<string> | string;
};

type WorkspaceToolDefinition<S extends TSchema> = {
  description: string;
  input: S;
  annotations?: ToolAnnotations;
  capabilities: ReadonlyArray<WorkspaceCapability>;
  handler: (input: Static<S>, workspace: Workspace) => Promise<string> | string;
};

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
export const toolFactory = <TRuntime>() => {
  function runtime<S extends TSchema>(
    definition: RuntimeToolDefinition<S, TRuntime> & {
      authorization: ToolAuthorization;
    },
  ): AuthorizedRuntimeTool<TRuntime>;
  function runtime<S extends TSchema>(
    definition: RuntimeToolDefinition<S, TRuntime> & {
      authorization?: never;
    },
  ): LegacyRuntimeTool<TRuntime>;
  function runtime<S extends TSchema>(
    definition: RuntimeToolDefinition<S, TRuntime> & {
      authorization?: ToolAuthorization;
    },
  ) {
    return { kind: RUNTIME_KIND, ...definition };
  }

  function workspace<S extends TSchema>(
    definition: WorkspaceToolDefinition<S> & {
      authorization: ToolAuthorization;
    },
  ): AuthorizedWorkspaceTool;
  function workspace<S extends TSchema>(
    definition: WorkspaceToolDefinition<S> & {
      authorization?: never;
    },
  ): LegacyWorkspaceTool;
  function workspace<S extends TSchema>(
    definition: WorkspaceToolDefinition<S> & {
      authorization?: ToolAuthorization;
    },
  ) {
    return { kind: WORKSPACE_KIND, ...definition };
  }

  return { runtime, workspace };
};

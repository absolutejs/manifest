import { Value } from "@sinclair/typebox/value";
import { digestToolInput } from "./security";
import type {
  AnyPackageManifest,
  BridgedAITool,
  BridgedMcpTool,
  ManifestTool,
  PackageManifest,
  ToolBindings,
  Workspace,
} from "./types";

const MAX_REPORTED_ERRORS = 3;

type CheckedInput =
  { ok: true; value: unknown } | { ok: false; message: string };

/** Validate + default the raw args against the tool's schema. Returns the
 *  cleaned value, or an error string the AI/MCP caller can act on. Handlers
 *  never see unvalidated input. */
const checkInput = (
  toolName: string,
  schema: ManifestTool<unknown>["input"],
  args: unknown,
) => {
  const withDefaults = Value.Default(schema, Value.Clone(args ?? {}));
  if (Value.Check(schema, withDefaults)) {
    const passed: CheckedInput = { ok: true, value: withDefaults };

    return passed;
  }
  const errors = [...Value.Errors(schema, withDefaults)]
    .slice(0, MAX_REPORTED_ERRORS)
    .map((error) => `${error.path || "/"}: ${error.message}`)
    .join("; ");
  const failed: CheckedInput = {
    message: `Invalid input for tool "${toolName}": ${errors}`,
    ok: false,
  };

  return failed;
};

const grantsCapabilities = (
  capabilities: ReadonlyArray<"exec" | "glob" | "read" | "write">,
  workspace: Workspace,
) =>
  capabilities.every(
    (capability) =>
      capability === "read" || workspace[capability] !== undefined,
  );

type BoundTool = {
  name: string;
  description: string;
  input: Record<string, unknown>;
  annotations?: ManifestTool<unknown>["annotations"];
  authorization?: ManifestTool<unknown>["authorization"];
  invoke: (args: unknown) => Promise<string> | string;
};

const freezeInput = (value: unknown): unknown => {
  if (typeof value !== "object" || value === null || Object.isFrozen(value))
    return value;
  for (const item of Object.values(value)) freezeInput(item);

  return Object.freeze(value);
};

/** Shared binding logic. Fails closed: a runtime tool without a runtime
 *  binding, or a workspace tool missing a granted capability, is OMITTED —
 *  registries list only callable tools. */
const bindTools = <TRuntime>(
  manifest: PackageManifest<never, TRuntime> | AnyPackageManifest,
  bindings: ToolBindings<TRuntime>,
) => {
  const { enforce, runtime, workspace } = bindings;

  const enforceInvocation = async (
    name: string,
    tool: ManifestTool<TRuntime>,
    args: unknown,
    invoke: (args: unknown) => Promise<string> | string,
  ) => {
    const checked = checkInput(name, tool.input, args);
    if (!checked.ok) return checked.message;
    if (manifest.contract !== 2 || !tool.authorization || !enforce)
      return "Tool execution enforcement is not configured";
    const input = freezeInput(checked.value);
    let active = true;
    let executed = false;
    const execute = () => {
      if (!active)
        throw new Error("Tool execution closure expired after enforcement");
      if (executed) throw new Error("Tool execution closure is single-use");
      executed = true;

      return invoke(input);
    };

    try {
      return await enforce(
        {
          args: input,
          authorization: tool.authorization,
          inputDigest: await digestToolInput(input),
          packageName: manifest.identity.name,
          toolName: name,
        },
        execute,
      );
    } finally {
      active = false;
    }
  };

  const bindInvoke = (name: string, tool: ManifestTool<TRuntime>) => {
    if (tool.kind === "runtime") {
      if (runtime === undefined) return undefined;

      return (args: unknown) => tool.handler(args, runtime);
    }
    if (
      workspace === undefined ||
      !grantsCapabilities(tool.capabilities, workspace)
    )
      return undefined;

    return (args: unknown) => tool.handler(args, workspace);
  };

  return Object.entries(manifest.tools ?? {}).flatMap(([name, tool]) => {
    if (manifest.contract !== 2 || !tool.authorization || !enforce) return [];
    const invoke = bindInvoke(name, tool);
    if (invoke === undefined) return [];

    const bound: BoundTool = {
      annotations: tool.annotations,
      authorization: tool.authorization,
      description: tool.description,
      input: tool.input,
      name,
      invoke: (args) => enforceInvocation(name, tool, args, invoke),
    };

    return [bound];
  });
};

/** Structurally satisfies @absolutejs/ai's AIToolMap — drop the result into
 *  `streamAIToSSE({ tools })`. Consumers running untrusted manifests should
 *  compose with that package's `hardenUntrustedTool`. */
export const toAIToolMap = <TRuntime>(
  manifest: PackageManifest<never, TRuntime> | AnyPackageManifest,
  bindings: ToolBindings<TRuntime>,
) => {
  const tools: Record<string, BridgedAITool> = Object.fromEntries(
    bindTools(manifest, bindings).map((tool) => [
      tool.name,
      {
        annotations: tool.annotations,
        authorization: tool.authorization,
        description: tool.description,
        handler: tool.invoke,
        input: tool.input,
      },
    ]),
  );

  return tools;
};

/** Structurally satisfies @absolutejs/mcp's McpToolRegistry — usable as the
 *  `tools` of an mcpServer config. */
export const toMcpToolRegistry = <TRuntime>(
  manifest: PackageManifest<never, TRuntime> | AnyPackageManifest,
  bindings: ToolBindings<TRuntime>,
) => {
  const tools: Record<string, BridgedMcpTool> = Object.fromEntries(
    bindTools(manifest, bindings).map((tool) => [
      tool.name,
      {
        annotations: tool.annotations,
        authorization: tool.authorization,
        ...("x-coaz-mapping" in tool.input ? { coaz: true as const } : {}),
        description: tool.description,
        handler: tool.invoke,
        inputSchema: tool.input,
      },
    ]),
  );

  return tools;
};

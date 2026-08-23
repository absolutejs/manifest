import { Type, type TSchema } from "typebox";
import { Value } from "typebox/value";
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

/**
 * typebox 1.x identifies its types by a marker rather than by JSON shape, and
 * a schema built by @sinclair/typebox 0.34 carries the same JSON without it.
 * `Value.Check` still validates such a schema, but `Value.Default` walks right
 * past it -- so a defaulted field silently goes missing and the caller is told
 * a required property is absent, which points at the wrong thing entirely.
 */
const isNativeSchema = (schema: unknown) =>
  Type.IsObject(schema) ||
  Type.IsUnion(schema) ||
  Type.IsArray(schema) ||
  Type.IsRecord(schema) ||
  Type.IsString(schema) ||
  Type.IsNumber(schema) ||
  Type.IsInteger(schema) ||
  Type.IsBoolean(schema) ||
  Type.IsNull(schema) ||
  Type.IsAny(schema) ||
  Type.IsUnknown(schema) ||
  Type.IsCyclic(schema);

/** Validate + default the raw args against the tool's schema. Returns the
 *  cleaned value, or an error string the AI/MCP caller can act on. Handlers
 *  never see unvalidated input. */
const checkInput = (
  toolName: string,
  schema: ManifestTool<unknown>["input"],
  args: unknown,
) => {
  if (!isNativeSchema(schema)) {
    const foreign: CheckedInput = {
      message:
        `Tool "${toolName}" was defined with a schema from a different ` +
        "TypeBox. Import Type from 'typebox' rather than '@sinclair/typebox'.",
      ok: false,
    };

    return foreign;
  }
  const withDefaults = Value.Default(schema, Value.Clone(args ?? {}));
  if (Value.Check(schema, withDefaults)) {
    const passed: CheckedInput = { ok: true, value: withDefaults };

    return passed;
  }
  const errors = [...Value.Errors(schema, withDefaults)]
    .slice(0, MAX_REPORTED_ERRORS)
    .map((error) => `${error.instancePath || "/"}: ${error.message}`)
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

/**
 * The AI and MCP tool shapes both type a tool's schema as a loose record. A
 * typebox 1.x schema is exactly that at runtime -- a plain JSON Schema object
 * -- but not in the type system, because 1.x declares its schema types as
 * interfaces and an interface carries no implicit index signature. Restating
 * the shape here keeps those published contracts unchanged.
 */
const asToolSchema = (schema: TSchema) =>
  Object.fromEntries(Object.entries(schema));

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
      input: asToolSchema(tool.input),
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
        input: asToolSchema(tool.input),
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

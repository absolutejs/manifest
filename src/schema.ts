import { Type } from "typebox";
import {
  TOOL_NAME_PATTERN,
  type AnyPackageManifest,
} from "./types";

/* The manifest's own TypeBox schema — the contract dogfooding itself.
 * It describes the SERIALIZABLE projection of a manifest (tool handlers
 * stripped): exactly what `absolute-manifest emit` writes to manifest.json
 * and what `loadManifest` validates after projecting an imported module.
 */

const envRequirement = Type.Object({
  description: Type.String(),
  docsUrl: Type.Optional(Type.String()),
  example: Type.Optional(Type.String()),
  key: Type.String({ pattern: "^[A-Z][A-Z0-9_]*$" }),
  optional: Type.Optional(Type.Boolean()),
  secret: Type.Optional(Type.Boolean()),
  when: Type.Optional(Type.String()),
});

const wiringImport = Type.Object({
  from: Type.String(),
  names: Type.Array(Type.String()),
  typeOnly: Type.Optional(Type.Boolean()),
});

const wiringSnippet = Type.Object({
  code: Type.String(),
  imports: Type.Array(wiringImport),
  placement: Type.Optional(
    Type.Union([
      Type.Literal("client-entry"),
      Type.Literal("module-scope"),
      Type.Literal("server-boundary"),
      Type.Literal("server-factory"),
      Type.Literal("server-plugin"),
    ]),
  ),
});

const clientFrameworks = [
  "angular",
  "client",
  "react",
  "svelte",
  "vue",
] as const;

const wiringRecipe = Type.Object({
  client: Type.Optional(
    Type.Partial(
      Type.Object(
        Object.fromEntries(
          clientFrameworks.map((framework) => [framework, wiringSnippet]),
        ),
      ),
    ),
  ),
  description: Type.Optional(Type.String()),
  id: Type.String({ minLength: 1 }),
  server: Type.Optional(wiringSnippet),
  title: Type.String(),
});

const adapterSlot = Type.Object({
  configPath: Type.String({ minLength: 1 }),
  contract: Type.String({ pattern: "^[a-z0-9-]+/[a-z0-9-]+$" }),
  description: Type.String(),
  known: Type.Optional(Type.Array(Type.String())),
  required: Type.Optional(Type.Boolean()),
});

/** Any JSON-Schema-shaped object (a TypeBox schema at rest is plain JSON). */
const jsonSchemaObject = Type.Record(Type.String(), Type.Unknown());

const peerRequirement = Type.Object({
  name: Type.String(),
  range: Type.String(),
  reason: Type.Optional(Type.String()),
});

const serviceRequirement = Type.Object({
  description: Type.String(),
  id: Type.String(),
  optional: Type.Optional(Type.Boolean()),
});

const manifestRequirements = Type.Object({
  env: Type.Optional(Type.Array(envRequirement)),
  peers: Type.Optional(Type.Array(peerRequirement)),
  services: Type.Optional(Type.Array(serviceRequirement)),
});

const adapterImplementation = Type.Object({
  contract: Type.String({ pattern: "^[a-z0-9-]+/[a-z0-9-]+$" }),
  factory: Type.String({ minLength: 1 }),
  from: Type.String({ minLength: 1 }),
  requires: Type.Optional(manifestRequirements),
  settings: Type.Optional(jsonSchemaObject),
  title: Type.String(),
  wiring: wiringSnippet,
});

const lifecycleStep = Type.Object({
  command: Type.Optional(Type.String()),
  docsUrl: Type.Optional(Type.String()),
  id: Type.String({ minLength: 1 }),
  idempotent: Type.Optional(Type.Boolean()),
  kind: Type.Union([
    Type.Literal("migration"),
    Type.Literal("post-install"),
    Type.Literal("verify"),
  ]),
  title: Type.String(),
  when: Type.Union([
    Type.Literal("after-install"),
    Type.Literal("after-upgrade"),
    Type.Literal("before-first-run"),
    Type.Literal("manual"),
  ]),
});

const toolAnnotations = Type.Object({
  destructiveHint: Type.Optional(Type.Boolean()),
  idempotentHint: Type.Optional(Type.Boolean()),
  openWorldHint: Type.Optional(Type.Boolean()),
  readOnlyHint: Type.Optional(Type.Boolean()),
  title: Type.Optional(Type.String()),
});

const toolAuthorization = Type.Object({
  approval: Type.Union([
    Type.Literal("always"),
    Type.Literal("never"),
    Type.Literal("policy"),
  ]),
  audience: Type.Union([
    Type.Literal("admin"),
    Type.Literal("authenticated"),
    Type.Literal("owner"),
    Type.Literal("public"),
  ]),
  compensatingTool: Type.Optional(
    Type.String({ pattern: TOOL_NAME_PATTERN.source }),
  ),
  destinationFields: Type.Optional(
    Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  ),
  destinations: Type.Optional(
    Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  ),
  effects: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  idempotency: Type.Optional(
    Type.Union([
      Type.Object({
        field: Type.String({ minLength: 1 }),
        mode: Type.Literal("field"),
      }),
      Type.Object({ mode: Type.Literal("host") }),
      Type.Object({ mode: Type.Literal("resource") }),
    ]),
  ),
  requiredScopes: Type.Optional(
    Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  ),
  resource: Type.Optional(
    Type.Object({
      idField: Type.Optional(Type.String({ minLength: 1 })),
      ownerIdField: Type.Optional(Type.String({ minLength: 1 })),
      tenantIdField: Type.Optional(Type.String({ minLength: 1 })),
      type: Type.String({ minLength: 1 }),
    }),
  ),
  reversible: Type.Optional(Type.Boolean()),
  spend: Type.Optional(
    Type.Object({
      amountMinorField: Type.String({ minLength: 1 }),
      currencyField: Type.String({ minLength: 1 }),
      maximumAmountMinor: Type.Optional(Type.Integer({ minimum: 0 })),
    }),
  ),
});

const serializedTool = Type.Object({
  annotations: Type.Optional(toolAnnotations),
  authorization: Type.Optional(toolAuthorization),
  capabilities: Type.Optional(
    Type.Array(
      Type.Union([
        Type.Literal("exec"),
        Type.Literal("glob"),
        Type.Literal("read"),
        Type.Literal("write"),
      ]),
    ),
  ),
  description: Type.String(),
  input: jsonSchemaObject,
  kind: Type.Union([Type.Literal("runtime"), Type.Literal("workspace")]),
});

const productId = Type.String({ pattern: "^[a-z][a-z0-9_-]{0,63}$" });
const productCopy: Record<string, ReturnType<typeof Type.String>> = {
  description: Type.String({ minLength: 1 }),
  id: productId,
  title: Type.String({ minLength: 1 }),
};
const productOperation = Type.Union([
  Type.Literal("aggregate"),
  Type.Literal("create"),
  Type.Literal("delete"),
  Type.Literal("detail"),
  Type.Literal("list"),
  Type.Literal("update"),
]);
const productProjection = Type.Object({
  blocks: Type.Optional(
    Type.Array(
      Type.Object({
        ...productCopy,
        category: Type.String({ minLength: 1 }),
        componentExport: Type.String({ minLength: 1 }),
        frameworks: Type.Optional(
          Type.Array(
            Type.Union(
              clientFrameworks.map((framework) => Type.Literal(framework)),
            ),
          ),
        ),
        props: jsonSchemaObject,
      }),
    ),
  ),
  connections: Type.Optional(
    Type.Array(
      Type.Object({
        ...productCopy,
        envKeys: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
        kind: Type.Union([
          Type.Literal("none"),
          Type.Literal("oauth"),
          Type.Literal("secret"),
        ]),
        setupTool: Type.Optional(
          Type.String({ pattern: TOOL_NAME_PATTERN.source }),
        ),
        testTool: Type.Optional(
          Type.String({ pattern: TOOL_NAME_PATTERN.source }),
        ),
      }),
    ),
  ),
  dataSources: Type.Optional(
    Type.Array(
      Type.Object({
        ...productCopy,
        operations: Type.Array(productOperation, { minItems: 1 }),
        schema: jsonSchemaObject,
        tools: Type.Optional(
          Type.Partial(
            Type.Object({
              aggregate: Type.String({ pattern: TOOL_NAME_PATTERN.source }),
              create: Type.String({ pattern: TOOL_NAME_PATTERN.source }),
              delete: Type.String({ pattern: TOOL_NAME_PATTERN.source }),
              detail: Type.String({ pattern: TOOL_NAME_PATTERN.source }),
              list: Type.String({ pattern: TOOL_NAME_PATTERN.source }),
              update: Type.String({ pattern: TOOL_NAME_PATTERN.source }),
            }),
          ),
        ),
      }),
    ),
  ),
  events: Type.Optional(
    Type.Array(
      Type.Object({
        ...productCopy,
        schema: jsonSchemaObject,
        source: Type.Union([
          Type.Literal("data"),
          Type.Literal("package"),
          Type.Literal("ui"),
          Type.Literal("webhook"),
        ]),
      }),
    ),
  ),
  healthChecks: Type.Optional(
    Type.Array(
      Type.Object({
        ...productCopy,
        tool: Type.String({ pattern: TOOL_NAME_PATTERN.source }),
      }),
    ),
  ),
  releaseChecks: Type.Optional(
    Type.Array(
      Type.Object({
        ...productCopy,
        healthCheckIds: Type.Optional(Type.Array(productId)),
        severity: Type.Union([
          Type.Literal("blocking"),
          Type.Literal("warning"),
        ]),
      }),
    ),
  ),
  workflowActions: Type.Optional(
    Type.Array(
      Type.Object({
        ...productCopy,
        tool: Type.String({ pattern: TOOL_NAME_PATTERN.source }),
      }),
    ),
  ),
});

export const manifestSchema = Type.Object({
  contract: Type.Union([Type.Literal(1), Type.Literal(2)]),
  discovery: Type.Optional(
    Type.Object({
      audiences: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
      certificationUrl: Type.Optional(Type.String()),
      intents: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
      keywords: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
      protocols: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
      url: Type.Optional(Type.String()),
    }),
  ),
  identity: Type.Object({
    accent: Type.Optional(Type.String({ pattern: "^#[0-9a-fA-F]{3,8}$" })),
    category: Type.String({ minLength: 1 }),
    description: Type.Optional(Type.String()),
    docsUrl: Type.Optional(Type.String()),
    logo: Type.Optional(
      Type.Object({
        svg: Type.Optional(Type.String()),
        url: Type.Optional(Type.String()),
      }),
    ),
    name: Type.String({
      pattern: "^(@[a-z0-9-~][a-z0-9-._~]*/)?[a-z0-9-~][a-z0-9-._~]*$",
    }),
    tagline: Type.String({ minLength: 1 }),
  }),
  implements: Type.Optional(Type.Array(adapterImplementation)),
  integration: Type.Optional(
    Type.Object({
      description: Type.Optional(Type.String({ minLength: 1 })),
      mode: Type.Union([
        Type.Literal("adapter"),
        Type.Literal("code-first"),
        Type.Literal("recipe"),
      ]),
    }),
  ),
  lifecycle: Type.Optional(Type.Array(lifecycleStep)),
  presets: Type.Optional(
    Type.Array(
      Type.Object({
        description: Type.Optional(Type.String()),
        id: Type.String({ minLength: 1 }),
        title: Type.String(),
        values: Type.Record(Type.String(), Type.Unknown()),
      }),
    ),
  ),
  product: Type.Optional(productProjection),
  requires: Type.Optional(manifestRequirements),
  settings: jsonSchemaObject,
  slots: Type.Optional(Type.Record(Type.String(), adapterSlot)),
  tools: Type.Optional(
    Type.Record(
      Type.String({ pattern: TOOL_NAME_PATTERN.source }),
      serializedTool,
    ),
  ),
  wiring: Type.Array(wiringRecipe),
});

/** Serializable projection of a manifest: tool handlers stripped, everything
 *  else passed through. Used by the emit CLI and by loadManifest validation —
 *  one projection so the two can never diverge. */
export const serializeManifest = (
  manifest: AnyPackageManifest,
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
                ...(tool.authorization === undefined
                  ? {}
                  : { authorization: tool.authorization }),
                ...(tool.kind === "workspace"
                  ? { capabilities: tool.capabilities }
                  : {}),
                description: tool.description,
                input: tool.input,
                kind: tool.kind,
              },
            ]),
          ),
        }),
  };
};

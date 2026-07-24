# @absolutejs/manifest

Version 0.4 makes remote tools secure by construction. Contract-2 manifests
declare enough policy metadata for a host or no-code control plane to explain,
approve, lease, execute, audit, and where possible compensate every action.
Contract-1 manifests still load for catalog and upgrade tooling, but their tools
are deliberately omitted from AI and MCP bridges.

## Agent action authorization (contract 2)

Contract 2 adds semantic tool effects and enforcement requirements. These are
policy inputs, not model hints:

```ts
send_email: tool.runtime({
  authorization: {
    approval: "policy",
    audience: "owner",
    destinationFields: ["to"],
    effects: ["send", "external-network"],
    idempotency: { mode: "host" },
    requiredScopes: ["email:send"],
    reversible: false,
  },
  // input, handler, description…
});
```

Bridges fail closed: tools are omitted unless the manifest is contract 2, the
tool has valid authorization metadata, its runtime or workspace capabilities
are available, and the host supplies `ToolBindings.enforce`. The enforcer gets
deep-frozen, validated, defaulted arguments, their canonical SHA-256 digest,
the package/tool identity, and a single-use execution closure. The closure
expires when enforcement returns, closing the approve-now/execute-different-
input gap. A host can wrap approval, authorization, idempotency leasing,
execution, and receipt recording around that exact closure.

`inspectManifestSecurity` returns per-tool posture and actionable issue codes
for catalogs and no-code UIs. It checks scopes, public exposure, destinations,
resource and spend bindings, idempotency, reversibility/compensation,
destructive hints, read-only hints, and every referenced input field.

The AbsoluteJS package manifest contract. Every `@absolutejs/*` package
exports a typed manifest from its `./manifest` subpath describing what the
package is, what it needs, how it wires into an app, and what AI tools it
offers. This package is the contract those manifests are written against —
plus the bridges that turn any manifest into an AI tool map
(`@absolutejs/ai`) or a remote MCP tool registry (`@absolutejs/mcp`), so
anyone can build AI tooling or MCP servers on top of the ecosystem's
manifests, not just AbsoluteJS's own products.

MIT licensed. Sole peer dependency: `@sinclair/typebox`.

## Why TypeBox

A TypeBox schema is simultaneously a TypeScript type (via `Static<>`) and a
plain JSON Schema object at runtime. That makes it the single source of truth
for a tool's input: the same schema types the handler at compile time and is
handed verbatim to AI providers (`input_schema`) and MCP (`inputSchema`). No
hand-written JSON Schema, no drift.

## Authoring a manifest

```ts
// src/manifest.ts of @absolutejs/dispatch
import { Type } from "@sinclair/typebox";
import { defineManifest, toolFactory } from "@absolutejs/manifest";
import type { Dispatcher, DispatcherOptions } from "./types";

const tool = toolFactory<Dispatcher>();

export const manifest = defineManifest<DispatcherOptions, Dispatcher>()({
  contract: 2,
  identity: {
    category: "messaging",
    name: "@absolutejs/dispatch",
    tagline: "Send email, texts, and push notifications from your site.",
  },
  settings: Type.Object({
    defaultFrom: Type.Optional(
      Type.Object(
        { email: Type.Optional(Type.String({ format: "email" })) },
        { title: "Default sender" },
      ),
    ),
  }),
  slots: {
    email: {
      configPath: "email",
      contract: "dispatch/email-adapter",
      description: "Email transport",
      known: ["@absolutejs/dispatch-resend", "@absolutejs/dispatch-postmark"],
    },
  },
  tools: {
    send_email: tool.runtime({
      annotations: { openWorldHint: true },
      authorization: {
        approval: "policy",
        audience: "owner",
        destinationFields: ["to"],
        effects: ["send", "external-network"],
        idempotency: { mode: "host" },
        requiredScopes: ["email:send"],
        reversible: false,
      },
      description: "Send a transactional email through the configured adapter.",
      handler: async (input, dispatcher) => {
        const result = await dispatcher.email(input);

        return `sent via ${result.provider}`;
      },
      input: Type.Object({
        subject: Type.String(),
        text: Type.String(),
        to: Type.String({ format: "email" }),
      }),
    }),
  },
  wiring: [
    {
      id: "default",
      server: {
        code: "const dispatcher = createDispatcher({ email: ${slot.email}, ...${settings} });",
        imports: [
          { from: "@absolutejs/dispatch", names: ["createDispatcher"] },
        ],
        placement: "module-scope",
      },
      title: "Create the dispatcher",
    },
  ],
});
```

`defineManifest<TConfig, TRuntime>()` is the drift-breaker: the `settings`
schema is checked against the package's real exported config type. Rename a
config key without updating the manifest and the package's own `tsc` fails at
this module. Type safety survives upgrades because it is enforced where the
types live.

Server wiring uses placement to preserve lifecycle semantics:
`server-boundary` is mounted before the first route (error capture, request
context, and other hooks that must observe every handler); `server-plugin`
joins the normal plugin chain; `module-scope` creates top-level resources; and
`server-factory` is reserved for host factory composition. Client recipes use
`client-entry`.

### Package plumbing

```jsonc
// package.json
{
  "absolutejs": {
    "manifestContract": 2,
    "runtimePeers": {
      "@absolutejs/agency": {
        "range": ">=0.7.1 <0.8.0",
        "tested": "0.7.1",
        "buildExternals": ["@absolutejs/agency", "@absolutejs/agency/*"],
      },
    },
  },
  "exports": {
    "./manifest": {
      "types": "./dist/manifest.d.ts",
      "import": "./dist/manifest.js",
    },
    "./manifest.json": "./dist/manifest.json",
  },
  "scripts": {
    "build": "… && absolute-manifest emit",
  },
}
```

`absolute-manifest emit` validates the manifest (schema, tool-key naming,
preset values, package.json agreement, and shared-runtime ownership) and writes
`dist/manifest.json` — the serializable projection (handlers stripped) for
consumers that can't execute package code. It is derived, never hand-authored,
so the two forms cannot diverge. `absolute-manifest scaffold` generates a
starter `src/manifest.ts`.

`absolutejs.runtimePeers` declares contracts that must be supplied once by the
host. The validator rejects a runtime duplicated in `dependencies`, a peer
range or optionality mismatch, a dev dependency that differs from the exact
tested version, and any missing build external. Keep compatibility windows
conservative; supporting a new pre-1.0 minor requires a deliberate package
release. Run `absolute-manifest verify-package` directly for packages that want
the package policy gate without emitting a manifest.

## Consuming manifests

```ts
import { loadManifest, toAIToolMap, toMcpToolRegistry } from '@absolutejs/manifest';

const result = await loadManifest('@absolutejs/dispatch');
if (!result.ok) throw new Error(result.details);

// AI tool loop (@absolutejs/ai)
const enforce = async (request, execute) => {
	await agency.authorizeAndLease(request);
	const toolResult = await execute();
	await agency.recordReceipt(request, toolResult);

	return toolResult;
};
const tools = toAIToolMap(result.manifest, { enforce, runtime: dispatcher });
streamAIToSSE({ tools, ... });

// Remote MCP server (@absolutejs/mcp)
new Elysia().use(mcpServer({
	path: '/mcp',
	tools: () => toMcpToolRegistry(result.manifest, { enforce, runtime: dispatcher })
}));
```

Bridges validate and default every call before enforcement and **fail closed**.
Contract-1 tools, unguarded tools, missing runtimes, unavailable workspace
capabilities, and hosts without an enforcer never appear in the registry.

Handlers receive nothing ambient — no `process.env`, no host secrets. A
`runtime` tool gets the package instance the host constructed; a `workspace`
tool gets the host's jailed `Workspace` (read/glob/write/exec, each granted
explicitly). Hosts running untrusted manifests should additionally compose
`@absolutejs/ai`'s `hardenUntrustedTool` over the bridged map.

## Adapter slots

Core packages declare **slots** (`contract: 'dispatch/email-adapter'`);
adapter packages declare `implements` entries with the same contract id.
Consumers resolve them by scanning installed manifests, so publishing a new
vendor adapter lights up every consumer without a core release. Reserved ids
and the frozen wiring placeholder grammar live in [CONTRACTS.md](./CONTRACTS.md).

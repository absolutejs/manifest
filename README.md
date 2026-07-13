# @absolutejs/manifest

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
import { Type } from '@sinclair/typebox';
import { defineManifest, toolFactory } from '@absolutejs/manifest';
import type { Dispatcher, DispatcherOptions } from './types';

const tool = toolFactory<Dispatcher>();

export const manifest = defineManifest<DispatcherOptions, Dispatcher>()({
	contract: 1,
	identity: {
		category: 'messaging',
		name: '@absolutejs/dispatch',
		tagline: 'Send email, texts, and push notifications from your site.'
	},
	settings: Type.Object({
		defaultFrom: Type.Optional(
			Type.Object(
				{ email: Type.Optional(Type.String({ format: 'email' })) },
				{ title: 'Default sender' }
			)
		)
	}),
	slots: {
		email: {
			configPath: 'email',
			contract: 'dispatch/email-adapter',
			description: 'Email transport',
			known: ['@absolutejs/dispatch-resend', '@absolutejs/dispatch-postmark']
		}
	},
	tools: {
		send_email: tool.runtime({
			annotations: { openWorldHint: true },
			description: 'Send a transactional email through the configured adapter.',
			handler: async (input, dispatcher) => {
				const result = await dispatcher.email(input);

				return `sent via ${result.provider}`;
			},
			input: Type.Object({
				subject: Type.String(),
				text: Type.String(),
				to: Type.String({ format: 'email' })
			})
		})
	},
	wiring: [
		{
			id: 'default',
			server: {
				code: 'const dispatcher = createDispatcher({ email: ${slot.email}, ...${settings} });',
				imports: [{ from: '@absolutejs/dispatch', names: ['createDispatcher'] }],
				placement: 'module-scope'
			},
			title: 'Create the dispatcher'
		}
	]
});

export default manifest;
```

`defineManifest<TConfig, TRuntime>()` is the drift-breaker: the `settings`
schema is checked against the package's real exported config type. Rename a
config key without updating the manifest and the package's own `tsc` fails at
this module. Type safety survives upgrades because it is enforced where the
types live.

### Package plumbing

```jsonc
// package.json
{
	"absolutejs": { "manifestContract": 1 },
	"exports": {
		"./manifest": {
			"types": "./dist/manifest.d.ts",
			"import": "./dist/manifest.js"
		},
		"./manifest.json": "./dist/manifest.json"
	},
	"scripts": {
		"build": "… && absolute-manifest emit"
	}
}
```

`absolute-manifest emit` validates the manifest (schema, tool-key naming,
preset values, package.json agreement) and writes `dist/manifest.json` — the
serializable projection (handlers stripped) for consumers that can't execute
package code. It is derived, never hand-authored, so the two forms cannot
diverge. `absolute-manifest scaffold` generates a starter `src/manifest.ts`.

## Consuming manifests

```ts
import { loadManifest, toAIToolMap, toMcpToolRegistry } from '@absolutejs/manifest';

const result = await loadManifest('@absolutejs/dispatch');
if (!result.ok) throw new Error(result.details);

// AI tool loop (@absolutejs/ai)
const tools = toAIToolMap(result.manifest, { runtime: dispatcher });
streamAIToSSE({ tools, ... });

// Remote MCP server (@absolutejs/mcp)
new Elysia().use(mcpServer({
	path: '/mcp',
	tools: () => toMcpToolRegistry(result.manifest, { runtime: dispatcher })
}));
```

Bridges validate every call's input against the tool's schema before the
handler runs (`Value.Default` + `Value.Check`), and **fail closed**: a
`runtime` tool without a runtime binding, or a `workspace` tool needing a
capability the host didn't grant, is omitted from the registry entirely.

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

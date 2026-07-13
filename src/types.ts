import type { Static, TSchema } from '@sinclair/typebox';

/* ─── Identity ─── */

// Stable category ids. Consumers map these to their own display names (the
// studio renders 'auth' as "Sign-in & accounts"); manifests never carry
// display copy for categories. The (string & {}) arm keeps the union open for
// third-party categories without losing autocomplete on the known ids.
export type ManifestCategory =
	| 'ai'
	| 'auth'
	| 'commerce'
	| 'compliance'
	| 'content'
	| 'data'
	| 'growth'
	| 'infrastructure'
	| 'media'
	| 'messaging'
	| 'observability'
	| 'storage'
	| 'sync'
	| 'voice'
	| 'web3'
	| (string & {});

export type ManifestIdentity = {
	/** npm name, e.g. '@absolutejs/auth'. Must match the package.json name. */
	name: string;
	category: ManifestCategory;
	/** One sentence, plain language, written for the site owner — not the
	 *  developer. 'Let people create accounts and sign in.' */
	tagline: string;
	/** Longer markdown description for catalogs and AI tool docs. */
	description?: string;
	/** Inline SVG preferred — renders offline inside sandboxed consumers.
	 *  url is a fallback for registries that can't inline. */
	logo?: { svg?: string; url?: string };
	/** Brand accent color, hex. */
	accent?: string;
	docsUrl?: string;
};

/* ─── Requirements ─── */

export type EnvRequirement = {
	/** 'GOOGLE_CLIENT_SECRET' */
	key: string;
	description: string;
	/** Never echo the value; mask in UIs; store only in the host's .env or
	 *  secret store. */
	secret?: boolean;
	optional?: boolean;
	/** Shape example, e.g. 'postgres://user:pass@host/db'. NEVER a real value. */
	example?: string;
	/** Where to obtain the credential (provider dashboard URL). */
	docsUrl?: string;
	/** Dot-path into the settings value gating this requirement: the key is
	 *  only required when the path resolves to a present/truthy value, e.g.
	 *  'providersConfiguration.google'. */
	when?: string;
};

export type PeerRequirement = {
	name: string;
	range: string;
	reason?: string;
};

export type ServiceRequirement = {
	id: 'postgres' | 'redis' | (string & {});
	description: string;
	optional?: boolean;
};

export type ManifestRequirements = {
	peers?: ReadonlyArray<PeerRequirement>;
	env?: ReadonlyArray<EnvRequirement>;
	services?: ReadonlyArray<ServiceRequirement>;
};

/* ─── Wiring ─── */

export type WiringImport = {
	from: string;
	names: ReadonlyArray<string>;
	typeOnly?: boolean;
};

export type WiringPlacement =
	| 'client-entry'
	| 'module-scope'
	| 'server-factory'
	| 'server-plugin';

/** `code` is a template using the contract's placeholder grammar. Exactly
 *  four forms exist in contract v1 — consumers must reject anything else:
 *
 *    ${settings}       — the configured settings object, as a literal
 *    ${settings.path}  — one settings value, serialized
 *    ${env.KEY}        — a `process.env.KEY` REFERENCE (never the value)
 *    ${slot.name}      — the expanded wiring of the adapter chosen for a slot
 *
 *  Manifests therefore never contain secret values, only env key references.
 */
export type WiringSnippet = {
	imports: ReadonlyArray<WiringImport>;
	code: string;
	placement?: WiringPlacement;
};

export type ClientFramework = 'angular' | 'client' | 'react' | 'svelte' | 'vue';

export type WiringRecipe = {
	/** 'default' is required; additional ids are named variants
	 *  (e.g. auth's 'credentials' flow). */
	id: string;
	title: string;
	description?: string;
	server?: WiringSnippet;
	client?: Partial<Record<ClientFramework, WiringSnippet>>;
};

/* ─── Adapter slots & implementations ─── */

/** A pluggable position in the package's config, filled by an adapter that
 *  implements a named contract. Contract ids are namespaced by the domain
 *  package ('dispatch/email-adapter', 'blob/store') and reserved in
 *  CONTRACTS.md; third parties mint their own under their own namespace. */
export type AdapterSlot = {
	/** Ecosystem-unique contract id: '<domain>/<contract>'. */
	contract: string;
	description: string;
	required?: boolean;
	/** Dot-path in the config object this slot fills (e.g. 'email',
	 *  'authSessionStore'), consumed by ${slot.name} expansion. The reserved
	 *  value '$self' means the slot's expansion IS the instance rather than
	 *  one field of a config object. */
	configPath: string;
	/** Non-exhaustive hint of implementations known at publish time. Entries
	 *  are npm names, or '<pkg>#<id>' self-references for built-ins that live
	 *  in the same package. Discovery by contract id is the real mechanism. */
	known?: ReadonlyArray<string>;
};

/** Declared by adapter packages — or by a core package for its built-ins
 *  (with a subpath `from` like '@absolutejs/blob/local'). */
export type AdapterImplementation = {
	/** Must match a slot's contract id somewhere in the ecosystem. */
	contract: string;
	/** Exported factory symbol, e.g. 'createResendAdapter'. */
	factory: string;
	/** Import specifier: the package itself or a subpath. */
	from: string;
	title: string;
	/** TypeBox schema for the wiring snippet's serializable parameters
	 *  (${settings} inside this implementation's wiring expands from it). */
	settings?: TSchema;
	/** What choosing this implementation additionally requires: env keys,
	 *  extra npm packages (e.g. the AWS SDK for the S3 store), services. */
	requires?: ManifestRequirements;
	/** Snippet producing the adapter instance; expands into the host slot's
	 *  ${slot.name} placeholder. */
	wiring: WiringSnippet;
};

/* ─── Lifecycle ─── */

export type LifecycleStep = {
	id: string;
	title: string;
	kind: 'migration' | 'post-install' | 'verify';
	/** Command template using the placeholder grammar (env references only).
	 *  Consumers run it with the host project's env; they should refuse
	 *  shells and spawn argv-style. */
	command?: string;
	when: 'after-install' | 'after-upgrade' | 'before-first-run' | 'manual';
	idempotent?: boolean;
	docsUrl?: string;
};

/* ─── Tools ─── */

/** MCP-shaped behavior hints. Structurally identical to
 *  @absolutejs/mcp's McpToolAnnotations and @absolutejs/ai's
 *  AIToolAnnotations — kept dependency-free on purpose. */
export type ToolAnnotations = {
	destructiveHint?: boolean;
	idempotentHint?: boolean;
	openWorldHint?: boolean;
	readOnlyHint?: boolean;
	title?: string;
};

/** The capability surface a HOST grants to workspace tools. Hosts implement
 *  it over their own sandbox (jailed root, validated writes, allowlisted
 *  exec); tools declare what they need via `capabilities` and are omitted
 *  from registries when the host can't grant them. */
export type Workspace = {
	root: string;
	read: (path: string) => Promise<string | null>;
	glob?: (pattern: string) => Promise<ReadonlyArray<string>>;
	write?: (path: string, contents: string) => Promise<void>;
	exec?: (
		command: string,
		args: ReadonlyArray<string>
	) => Promise<{ code: number; stdout: string; stderr: string }>;
};

export type WorkspaceCapability = 'exec' | 'glob' | 'read' | 'write';

/** Runs wherever the package's live instance exists; the host supplies the
 *  instance as the second argument. Handlers receive NOTHING ambient — no
 *  process.env, no fetch context, no host secrets. */
export type RuntimeTool<TRuntime> = {
	kind: 'runtime';
	description: string;
	/** TypeBox schema. At runtime it IS the JSON Schema handed to AI
	 *  providers (input_schema) and MCP (inputSchema); at compile time
	 *  Static<> of it types the handler input. The single source of truth. */
	input: TSchema;
	annotations?: ToolAnnotations;
	handler: (input: unknown, runtime: TRuntime) => Promise<string> | string;
};

/** Runs against a host-granted Workspace (project files). Same ambient-free
 *  rule as runtime tools. */
export type WorkspaceTool = {
	kind: 'workspace';
	description: string;
	input: TSchema;
	annotations?: ToolAnnotations;
	capabilities: ReadonlyArray<WorkspaceCapability>;
	handler: (input: unknown, workspace: Workspace) => Promise<string> | string;
};

export type ManifestTool<TRuntime> = RuntimeTool<TRuntime> | WorkspaceTool;

/** Tool keys must satisfy this: snake_case, no dots — the studio namespaces
 *  them as <shortName>__<toolName> and AI providers enforce
 *  ^[a-zA-Z0-9_-]{1,128}$ on the combined name. */
export const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

/* ─── Presets ─── */

export type SettingsPreset = {
	id: string;
	title: string;
	description?: string;
	/** Validated against `settings` by `absolute-manifest emit`. */
	values: Record<string, unknown>;
};

/* ─── The manifest ─── */

export type PackageManifest<TConfig = unknown, TRuntime = unknown> = {
	/** Version of THIS contract (the @absolutejs/manifest schema), not the
	 *  package. The package's own version is read from its package.json — the
	 *  manifest ships inside the package, so its version IS the package
	 *  version. */
	contract: 1;
	identity: ManifestIdentity;
	requires?: ManifestRequirements;
	/** TypeBox schema for the SERIALIZABLE subset of the package's config
	 *  type. Function-valued config (callbacks, store instances) is expressed
	 *  via slots and wiring recipes instead — never in settings. Field-level
	 *  copy rides standard schema annotations: `title` (label),
	 *  `description` (help), `examples[0]` (placeholder), and the custom
	 *  `x-group` keyword (settings-UI section). */
	settings: TSchema;
	presets?: ReadonlyArray<SettingsPreset>;
	slots?: Record<string, AdapterSlot>;
	implements?: ReadonlyArray<AdapterImplementation>;
	wiring: ReadonlyArray<WiringRecipe>;
	lifecycle?: ReadonlyArray<LifecycleStep>;
	tools?: Record<string, ManifestTool<TRuntime>>;
	/** Phantom marker so TConfig survives for consumers; erased at runtime. */
	__config?: (config: TConfig) => void;
};

export type AnyPackageManifest = PackageManifest<unknown, unknown>;

/* ─── Bridge output shapes (structural, dependency-free) ─── */

/** Structurally satisfies @absolutejs/ai's AIToolDefinition. */
export type BridgedAITool = {
	description: string;
	input: Record<string, unknown>;
	handler: (input: unknown) => Promise<string> | string;
	annotations?: ToolAnnotations;
};

/** Structurally satisfies @absolutejs/mcp's McpTool. */
export type BridgedMcpTool = {
	description: string;
	inputSchema: Record<string, unknown>;
	handler: (args: unknown) => Promise<string> | string;
	annotations?: ToolAnnotations;
};

export type ToolBindings<TRuntime> = {
	runtime?: TRuntime;
	workspace?: Workspace;
};

/* ─── Static helpers ─── */

export type SettingsOf<M> =
	M extends PackageManifest<infer _TConfig, infer _TRuntime>
		? M['settings'] extends TSchema
			? Static<M['settings']>
			: never
		: never;

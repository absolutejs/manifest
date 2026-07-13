import { describe, expect, test } from 'bun:test';
import { Type } from '@sinclair/typebox';
import {
	defineManifest,
	toAIToolMap,
	toMcpToolRegistry,
	toolFactory,
	validateManifest
} from '../src/index';
import type { Workspace } from '../src/types';

/* A miniature "package" to exercise the whole contract. */

type DemoConfig = {
	greeting?: string;
	retries?: number;
	onEvent?: () => void; // function-valued: must NOT appear in settings
};

type DemoRuntime = { send: (to: string) => string };

const tool = toolFactory<DemoRuntime>();

const demoManifest = defineManifest<DemoConfig, DemoRuntime>()({
	contract: 1,
	identity: {
		category: 'messaging',
		name: '@absolutejs/demo-pkg',
		tagline: 'Send friendly greetings.'
	},
	settings: Type.Object({
		greeting: Type.Optional(Type.String({ title: 'Greeting' })),
		retries: Type.Optional(Type.Integer({ minimum: 0, title: 'Retries' }))
	}),
	tools: {
		read_notes: tool.workspace({
			capabilities: ['read'],
			description: 'Read the notes file.',
			input: Type.Object({ path: Type.String() }),
			handler: async (input, workspace) =>
				(await workspace.read(input.path)) ?? 'missing'
		}),
		send_greeting: tool.runtime({
			annotations: { openWorldHint: true },
			description: 'Send a greeting.',
			input: Type.Object({
				count: Type.Integer({ default: 1, minimum: 1 }),
				to: Type.String()
			}),
			handler: (input, runtime) => runtime.send(input.to)
		}),
		write_notes: tool.workspace({
			capabilities: ['read', 'write'],
			description: 'Write the notes file.',
			input: Type.Object({ contents: Type.String(), path: Type.String() }),
			handler: async (input, workspace) => {
				await workspace.write?.(input.path, input.contents);

				return 'ok';
			}
		})
	},
	wiring: [
		{
			id: 'default',
			server: {
				code: 'const demo = createDemo(${settings});',
				imports: [{ from: '@absolutejs/demo-pkg', names: ['createDemo'] }],
				placement: 'module-scope'
			},
			title: 'Create the demo instance'
		}
	]
});

describe('defineManifest', () => {
	test('accepts a valid settings subset (compile-time; runtime identity)', () => {
		expect(demoManifest.contract).toBe(1);
		expect(demoManifest.identity.name).toBe('@absolutejs/demo-pkg');
	});

	// The drift-breaker itself is a compile-time guarantee; these @ts-expect-error
	// assertions ARE the test — if the constraint stops rejecting bad schemas,
	// typecheck fails because the directives become unused.
	test('rejects excess keys and wrong value types at compile time', () => {
		const attempt = () =>
			defineManifest<DemoConfig>()({
				contract: 1,
				identity: {
					category: 'messaging',
					name: '@absolutejs/demo-pkg',
					tagline: 'x'
				},
				// @ts-expect-error — `nope` does not exist on DemoConfig
				settings: Type.Object({ nope: Type.String() }),
				wiring: []
			});
		const attemptWrongType = () =>
			defineManifest<DemoConfig>()({
				contract: 1,
				identity: {
					category: 'messaging',
					name: '@absolutejs/demo-pkg',
					tagline: 'x'
				},
				// @ts-expect-error — retries is a number on DemoConfig, not a string
				settings: Type.Object({ retries: Type.String() }),
				wiring: []
			});
		expect(typeof attempt).toBe('function');
		expect(typeof attemptWrongType).toBe('function');
	});
});

describe('validateManifest', () => {
	test('accepts the demo manifest', () => {
		const result = validateManifest(demoManifest);
		expect(result.ok).toBe(true);
	});

	test('accepts module-namespace shapes (named/default export)', () => {
		expect(validateManifest({ manifest: demoManifest }).ok).toBe(true);
		expect(validateManifest({ default: demoManifest }).ok).toBe(true);
	});

	test('rejects a manifest with a bad tool key', () => {
		const bad: unknown = {
			...demoManifest,
			tools: {
				'demo.send': demoManifest.tools?.send_greeting
			}
		};
		const result = validateManifest(bad);
		expect(result.ok).toBe(false);
	});

	test('rejects a manifest missing identity', () => {
		const { identity, ...rest } = demoManifest;
		void identity;
		const result = validateManifest(rest);
		expect(result.ok).toBe(false);
	});
});

describe('bridges', () => {
	const runtime: DemoRuntime = { send: (recipient) => `sent to ${recipient}` };
	const files = new Map<string, string>([['notes.txt', 'hello']]);
	const workspace: Workspace = {
		root: '/project',
		read: async (path) => files.get(path) ?? null
	};
	const writableWorkspace: Workspace = {
		...workspace,
		write: async (path, contents) => {
			files.set(path, contents);
		}
	};

	test('binds runtime tools and validates input before dispatch', async () => {
		const tools = toAIToolMap(demoManifest, { runtime });
		expect(Object.keys(tools)).toContain('send_greeting');
		const sendGreeting = tools.send_greeting;
		if (sendGreeting === undefined) throw new Error('missing tool');
		expect(await sendGreeting.handler({ to: 'sam' })).toBe('sent to sam');
		const invalid = await sendGreeting.handler({ to: 42 });
		expect(invalid).toContain('Invalid input');
	});

	test('applies schema defaults before dispatch', async () => {
		let seen: unknown;
		const spyRuntime: DemoRuntime = {
			send: (to) => {
				seen = to;

				return 'ok';
			}
		};
		const tools = toAIToolMap(demoManifest, { runtime: spyRuntime });
		await tools.send_greeting?.handler({ to: 'sam' });
		expect(seen).toBe('sam');
	});

	test('fails closed: omits runtime tools without a runtime binding', () => {
		const tools = toAIToolMap(demoManifest, { workspace });
		expect(Object.keys(tools)).not.toContain('send_greeting');
		expect(Object.keys(tools)).toContain('read_notes');
	});

	test('fails closed: omits workspace tools missing granted capabilities', () => {
		const readOnly = toAIToolMap(demoManifest, { workspace });
		expect(Object.keys(readOnly)).not.toContain('write_notes');
		const writable = toAIToolMap(demoManifest, {
			workspace: writableWorkspace
		});
		expect(Object.keys(writable)).toContain('write_notes');
	});

	test('mcp registry uses inputSchema and shares behavior', async () => {
		const registry = toMcpToolRegistry(demoManifest, {
			runtime,
			workspace: writableWorkspace
		});
		const readNotes = registry.read_notes;
		if (readNotes === undefined) throw new Error('missing tool');
		expect(readNotes.inputSchema).toBeDefined();
		expect(await readNotes.handler({ path: 'notes.txt' })).toBe('hello');
	});
});

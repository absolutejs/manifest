/* Structural-compat regression tests: the bridges must stay assignable to the
 * real @absolutejs/ai and @absolutejs/mcp registry types WITHOUT this package
 * depending on either at runtime. Type-only imports; if either package
 * changes shape incompatibly, this file stops compiling. */
import { describe, expect, test } from 'bun:test';
import type { AIToolMap } from '@absolutejs/ai';
import type { McpToolRegistry } from '@absolutejs/mcp';
import { Type } from '@sinclair/typebox';
import { defineManifest, toAIToolMap, toMcpToolRegistry, toolFactory } from '../src/index';

type Runtime = { ping: () => string };
const tool = toolFactory<Runtime>();

const manifest = defineManifest<Record<never, never>, Runtime>()({
	contract: 1,
	identity: {
		category: 'infrastructure',
		name: '@absolutejs/compat-demo',
		tagline: 'Compat fixture.'
	},
	settings: Type.Object({}),
	tools: {
		ping: tool.runtime({
			description: 'Ping.',
			handler: (_input, runtime) => runtime.ping(),
			input: Type.Object({})
		})
	},
	wiring: [{ id: 'default', title: 'noop' }]
});

describe('structural compatibility', () => {
	const bindings = { runtime: { ping: () => 'pong' } };

	test('toAIToolMap output is assignable to AIToolMap', async () => {
		const aiTools: AIToolMap = toAIToolMap(manifest, bindings);
		const ping = aiTools.ping;
		if (ping === undefined) throw new Error('missing tool');
		expect(await ping.handler({})).toBe('pong');
	});

	test('toMcpToolRegistry output is assignable to McpToolRegistry', async () => {
		const mcpTools: McpToolRegistry = toMcpToolRegistry(manifest, bindings);
		const ping = mcpTools.ping;
		if (ping === undefined) throw new Error('missing tool');
		expect(await ping.handler({})).toBe('pong');
	});
});

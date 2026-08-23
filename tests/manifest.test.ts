import { describe, expect, test } from "bun:test";
import { Type } from "typebox";
import {
  defineManifest,
  toAIToolMap,
  toMcpToolRegistry,
  toolFactory,
  validateManifest,
} from "../src/index";
import type { PackageManifest, ToolBindings, Workspace } from "../src/types";

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
    category: "messaging",
    name: "@absolutejs/demo-pkg",
    tagline: "Send friendly greetings.",
  },
  settings: Type.Object({
    greeting: Type.Optional(Type.String({ title: "Greeting" })),
    retries: Type.Optional(Type.Integer({ minimum: 0, title: "Retries" })),
  }),
  tools: {
    read_notes: tool.workspace({
      capabilities: ["read"],
      description: "Read the notes file.",
      input: Type.Object({ path: Type.String() }),
      handler: async (input, workspace) =>
        (await workspace.read(input.path)) ?? "missing",
    }),
    send_greeting: tool.runtime({
      annotations: { openWorldHint: true },
      description: "Send a greeting.",
      input: Type.Object({
        count: Type.Integer({ default: 1, minimum: 1 }),
        to: Type.String(),
      }),
      handler: (input, runtime) => runtime.send(input.to),
    }),
    write_notes: tool.workspace({
      capabilities: ["read", "write"],
      description: "Write the notes file.",
      input: Type.Object({ contents: Type.String(), path: Type.String() }),
      handler: async (input, workspace) => {
        await workspace.write?.(input.path, input.contents);

        return "ok";
      },
    }),
  },
  wiring: [
    {
      id: "default",
      server: {
        code: "const demo = createDemo(${settings});",
        imports: [{ from: "@absolutejs/demo-pkg", names: ["createDemo"] }],
        placement: "module-scope",
      },
      title: "Create the demo instance",
    },
  ],
});

describe("defineManifest", () => {
  test("accepts a valid settings subset (compile-time; runtime identity)", () => {
    expect(demoManifest.contract).toBe(1);
    expect(demoManifest.identity.name).toBe("@absolutejs/demo-pkg");
  });
});

describe("validateManifest", () => {
  test("accepts the demo manifest", () => {
    const result = validateManifest(demoManifest);
    expect(result.ok).toBe(true);
  });

  test("accepts an early server boundary placement", () => {
    const boundary: unknown = {
      ...demoManifest,
      wiring: [
        {
          id: "default",
          server: {
            code: ".use(errorsPlugin({ server: { capture } }))",
            imports: [
              {
                from: "@absolutejs/errors/elysia",
                names: ["errorsPlugin"],
              },
            ],
            placement: "server-boundary",
          },
          title: "Capture every route",
        },
      ],
    };

    expect(validateManifest(boundary).ok).toBe(true);
  });

  test("accepts module-namespace shapes (named/default export)", () => {
    expect(validateManifest({ manifest: demoManifest }).ok).toBe(true);
    expect(validateManifest({ default: demoManifest }).ok).toBe(true);
  });

  test("rejects a manifest with a bad tool key", () => {
    const bad: unknown = {
      ...demoManifest,
      tools: {
        "demo.send": demoManifest.tools?.send_greeting,
      },
    };
    const result = validateManifest(bad);
    expect(result.ok).toBe(false);
  });

  test("rejects a manifest missing identity", () => {
    const { identity, ...rest } = demoManifest;
    void identity;
    const result = validateManifest(rest);
    expect(result.ok).toBe(false);
  });

  test("enforces explicit no-code integration roles", () => {
    expect(
      validateManifest({
        ...demoManifest,
        integration: { mode: "recipe" },
      }).ok,
    ).toBe(true);
    expect(
      validateManifest({
        ...demoManifest,
        integration: { mode: "code-first" },
      }),
    ).toMatchObject({
      details:
        'integration mode "code-first" cannot declare automatic wiring recipes',
      ok: false,
    });
    expect(
      validateManifest({
        ...demoManifest,
        integration: { mode: "adapter" },
        wiring: [],
      }),
    ).toMatchObject({
      details:
        'integration mode "adapter" requires at least one implementation',
      ok: false,
    });
    expect(
      validateManifest({
        ...demoManifest,
        integration: { mode: "recipe" },
        wiring: [],
      }),
    ).toMatchObject({
      details: 'integration mode "recipe" requires at least one wiring recipe',
      ok: false,
    });
  });

  test("validates customer-facing product projections against guarded tools", () => {
    const readNotesTool = demoManifest.tools?.read_notes;
    const sendGreetingTool = demoManifest.tools?.send_greeting;
    if (!readNotesTool || readNotesTool.kind !== "workspace")
      throw new Error("Demo read tool is required");
    if (!sendGreetingTool || sendGreetingTool.kind !== "runtime")
      throw new Error("Demo send tool is required");
    const productManifest: PackageManifest<DemoConfig, DemoRuntime> = {
      ...demoManifest,
      contract: 2 as const,
      product: {
        connections: [
          {
            description: "Connect the greeting service.",
            envKeys: ["GREETING_TOKEN"],
            id: "greeting",
            kind: "secret" as const,
            testTool: "read_notes",
            title: "Greeting connection",
          },
        ],
        healthChecks: [
          {
            description: "Check that notes can be read.",
            id: "notes",
            title: "Notes health",
            tool: "read_notes",
          },
        ],
        releaseChecks: [
          {
            description: "Require readable notes.",
            healthCheckIds: ["notes"],
            id: "notes_ready",
            severity: "blocking" as const,
            title: "Notes are ready",
          },
        ],
        workflowActions: [
          {
            description: "Send one greeting.",
            id: "send",
            title: "Send greeting",
            tool: "send_greeting",
          },
        ],
      },
      requires: {
        env: [
          {
            description: "Greeting token",
            key: "GREETING_TOKEN",
            secret: true,
          },
        ],
      },
      tools: {
        read_notes: {
          ...readNotesTool,
          annotations: { readOnlyHint: true },
          authorization: {
            approval: "never" as const,
            audience: "owner" as const,
            effects: ["read"],
            requiredScopes: ["notes:read"],
          },
        },
        send_greeting: {
          ...sendGreetingTool,
          authorization: {
            approval: "policy" as const,
            audience: "owner" as const,
            destinationFields: ["to"],
            effects: ["send"],
            idempotency: { mode: "host" as const },
            requiredScopes: ["greetings:send"],
            reversible: false,
          },
        },
      },
    };

    const productResult = validateManifest(productManifest);
    expect(productResult.ok).toBe(true);
    expect(
      validateManifest({
        ...productManifest,
        product: {
          ...productManifest.product,
          workflowActions: [
            {
              description: "Invent authority.",
              id: "invent",
              title: "Invent",
              tool: "missing_tool",
            },
          ],
        },
      }),
    ).toMatchObject({
      details:
        'product.workflowActions "invent" references missing tool "missing_tool"',
      ok: false,
    });
  });
});

describe("legacy bridge boundary", () => {
  const runtime: DemoRuntime = { send: (recipient) => `sent to ${recipient}` };
  const files = new Map<string, string>([["notes.txt", "hello"]]);
  const workspace: Workspace = {
    root: "/project",
    read: async (path) => files.get(path) ?? null,
  };
  const writableWorkspace: Workspace = {
    ...workspace,
    write: async (path, contents) => {
      files.set(path, contents);
    },
  };

  test("omits all contract-1 tools from remote registries", () => {
    const tools = toAIToolMap(demoManifest, { runtime });
    expect(Object.keys(tools)).toEqual([]);
    expect(
      Object.keys(
        toMcpToolRegistry(demoManifest, {
          runtime,
          workspace: writableWorkspace,
          enforce: (_request, execute) => execute(),
        }),
      ),
    ).toEqual([]);
  });
});

describe("contract v2 agent authorization", () => {
  const guardedManifest = defineManifest<Record<never, never>, DemoRuntime>()({
    contract: 2,
    identity: {
      category: "messaging",
      name: "@absolutejs/guarded-demo",
      tagline: "Exercise enforceable tool metadata.",
    },
    settings: Type.Object({}),
    tools: {
      read_notes: tool.workspace({
        annotations: { readOnlyHint: true },
        authorization: {
          approval: "never",
          audience: "authenticated",
          effects: ["read"],
          requiredScopes: ["notes:read"],
        },
        capabilities: ["read"],
        description: "Read the notes file.",
        input: Type.Object({ path: Type.String() }),
        handler: async (input, workspace) =>
          (await workspace.read(input.path)) ?? "missing",
      }),
      send_message: tool.runtime({
        annotations: { openWorldHint: true },
        authorization: {
          approval: "policy",
          audience: "owner",
          destinationFields: ["to"],
          effects: ["send", "external-network"],
          idempotency: { mode: "host" },
          requiredScopes: ["messages:send"],
          reversible: false,
        },
        description: "Send a message.",
        input: Type.Object({
          count: Type.Integer({ default: 1 }),
          to: Type.String(),
        }),
        handler: ({ to: recipient }, runtime) => runtime.send(recipient),
      }),
      write_notes: tool.workspace({
        annotations: { idempotentHint: true },
        authorization: {
          approval: "policy",
          audience: "owner",
          effects: ["write"],
          idempotency: { mode: "resource" },
          requiredScopes: ["notes:write"],
          resource: { idField: "path", type: "project-file" },
          reversible: false,
        },
        capabilities: ["read", "write"],
        description: "Write the notes file.",
        input: Type.Object({ contents: Type.String(), path: Type.String() }),
        handler: async (input, workspace) => {
          await workspace.write?.(input.path, input.contents);

          return "ok";
        },
      }),
    },
    wiring: [{ id: "default", title: "noop" }],
  });

  test("serializes and validates semantic effects", () => {
    expect(validateManifest(guardedManifest).ok).toBe(true);
  });

  test("rejects authorization metadata mislabeled as contract v1", () => {
    expect(validateManifest({ ...guardedManifest, contract: 1 }).ok).toBe(
      false,
    );
  });

  test("fails closed when no authorization binding exists", () => {
    const tools = toAIToolMap(guardedManifest, {
      runtime: { send: (recipient) => `sent to ${recipient}` },
    });
    expect(tools.send_message).toBeUndefined();
  });

  test("enforces policy atomically before dispatching", async () => {
    let called = false;
    const tools = toMcpToolRegistry(guardedManifest, {
      runtime: {
        send: () => {
          called = true;

          return "sent";
        },
      },
      enforce: ({ authorization }) =>
        authorization.effects.includes("send")
          ? "approval_required"
          : "unexpected",
    });
    expect(await tools.send_message?.handler({ to: "sam" })).toBe(
      "approval_required",
    );
    expect(called).toBe(false);
  });

  test("validates and defaults the exact input before enforcement", async () => {
    let seen: unknown;
    const tools = toAIToolMap(guardedManifest, {
      runtime: { send: (recipient) => `sent to ${recipient}` },
      enforce: (request, execute) => {
        seen = request;

        return execute();
      },
    });
    expect(await tools.send_message?.handler({ to: "sam" })).toBe(
      "sent to sam",
    );
    expect(seen).toMatchObject({
      args: { count: 1, to: "sam" },
      inputDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      packageName: "@absolutejs/guarded-demo",
      toolName: "send_message",
    });
    expect(await tools.send_message?.handler({ to: 42 })).toContain(
      "Invalid input",
    );
  });

  test("uses a single-use execution closure that expires after enforcement", async () => {
    let captured: (() => Promise<string> | string) | undefined;
    const tools = toAIToolMap(guardedManifest, {
      runtime: { send: () => "sent" },
      enforce: (_request, execute) => {
        captured = execute;

        return execute();
      },
    });
    expect(await tools.send_message?.handler({ to: "sam" })).toBe("sent");
    expect(() => captured?.()).toThrow("expired");
  });

  test("omits tools without bindings or workspace capabilities", () => {
    const allow: Pick<ToolBindings<DemoRuntime>, "enforce"> = {
      enforce: (_request: unknown, execute: () => Promise<string> | string) =>
        execute(),
    };
    const runtimeOnly = toAIToolMap(guardedManifest, {
      ...allow,
      runtime: { send: () => "sent" },
    });
    expect(runtimeOnly.read_notes).toBeUndefined();
    const readOnly = toAIToolMap(guardedManifest, {
      ...allow,
      workspace: { root: "/project", read: async () => null },
    });
    expect(readOnly.read_notes).toBeDefined();
    expect(readOnly.write_notes).toBeUndefined();
  });
});

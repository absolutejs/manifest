/* A tool defined with a schema from @sinclair/typebox 0.34 rather than typebox
 * 1.x used to fail in the most misleading way available: `Value.Check` still
 * understands the foreign JSON, but `Value.Default` walks past it, so a field
 * with a default silently went missing and the caller was told the property
 * was required. The bridge names the real cause instead. */
import { describe, expect, test } from "bun:test";
import { Type as LegacyType } from "@sinclair/typebox";
import { Type } from "typebox";
import { defineManifest, toAIToolMap, toolFactory } from "../src/index";
import type { ToolBindings } from "../src/types";

type Runtime = { send: (recipient: string) => string };
const tool = toolFactory<Runtime>();

/** A schema that reached us from somewhere else, with the type erased the way
 *  an untyped boundary would erase it. */
const fromElsewhere = (schema: unknown) => JSON.parse(JSON.stringify(schema));

const readRecipient = (value: unknown) => {
  if (typeof value !== "object" || value === null) return "nobody";
  const entries = Object.entries(value);
  const found = entries.find(([key]) => key === "recipient")?.[1];

  return typeof found === "string" ? found : "nobody";
};

const manifestWith = (input: ReturnType<typeof fromElsewhere>) =>
  defineManifest<Record<never, never>, Runtime>()({
    contract: 2,
    identity: {
      category: "infrastructure",
      name: "@absolutejs/foreign-demo",
      tagline: "Foreign schema fixture.",
    },
    settings: Type.Object({}),
    tools: {
      send: tool.runtime({
        annotations: { openWorldHint: true },
        authorization: {
          approval: "never",
          audience: "authenticated",
          effects: ["write"],
          requiredScopes: ["messages:send"],
        },
        description: "Send.",
        input,
        handler: (value, runtime) => runtime.send(readRecipient(value)),
      }),
    },
    wiring: [{ id: "default", title: "noop" }],
  });

const bindings: ToolBindings<Runtime> = {
  runtime: { send: (recipient) => `sent to ${recipient}` },
  enforce: (_request, execute) => execute(),
};

const invoke = async (input: ReturnType<typeof fromElsewhere>) => {
  const { send } = toAIToolMap(manifestWith(input), bindings);
  if (send === undefined) throw new Error("missing tool");

  return String(await send.handler({ recipient: "sam" }));
};

describe("schemas from a different TypeBox", () => {
  test("a native schema applies its defaults and runs", async () => {
    expect(
      await invoke(
        Type.Object({
          count: Type.Integer({ default: 1 }),
          recipient: Type.String(),
        }),
      ),
    ).toBe("sent to sam");
  });

  test("a 0.34 schema is named as the cause, not reported as missing input", async () => {
    const message = await invoke(
      fromElsewhere(
        LegacyType.Object({
          count: LegacyType.Integer({ default: 1 }),
          recipient: LegacyType.String(),
        }),
      ),
    );

    expect(message).toContain("different");
    expect(message).toContain("typebox");
    // The old failure blamed the caller's input for a field the schema defaults.
    expect(message).not.toContain("required properties count");
  });
});

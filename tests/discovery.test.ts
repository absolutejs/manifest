import { describe, expect, test } from "bun:test";
import { Type } from "@sinclair/typebox";
import {
  defineManifest,
  manifestToAgentCatalogEntry,
  manifestsToAgentCatalogJsonLd,
  manifestsToAgentsText,
  toMcpToolRegistry,
  validateManifest,
} from "../src";

const manifest = defineManifest<unknown, Record<string, never>>()({
  contract: 2,
  discovery: {
    intents: ["send email"],
    keywords: ["agent automation"],
    protocols: ["MCP", "AuthZEN COAZ"],
  },
  identity: {
    category: "messaging",
    description: "Send transactional email safely.",
    name: "@absolutejs/example-agent",
    tagline: "Send email.",
  },
  implements: [],
  settings: Type.Object({}),
  slots: {},
  tools: {
    send_email: {
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
      description: "Send one email",
      input: Type.Object(
        {
          to: Type.String(),
          "x-coaz-mapping": Type.Optional(Type.Unknown()),
        },
        { "x-coaz-mapping": { subject: [{ id: "token.sub" }] } },
      ),
      kind: "runtime",
      handler: (...values: [unknown, Record<string, never>]) => {
        void values;

        return "sent";
      },
    },
  },
  wiring: [],
});

describe("agent catalog discovery", () => {
  test("emits deterministic JSON-LD and agents.txt surfaces", () => {
    expect(validateManifest(manifest).ok).toBe(true);
    const entry = manifestToAgentCatalogEntry(manifest);
    expect(entry.intents).toContain("send email");
    expect(entry.keywords).toContain("agent automation");
    expect(manifestsToAgentCatalogJsonLd([manifest])["@type"]).toBe("ItemList");
    expect(manifestsToAgentsText([manifest])).toContain("AuthZEN COAZ");
  });

  test("marks MCP tools COAZ when the input schema declares a mapping", () => {
    const tool = toMcpToolRegistry(manifest, {
      runtime: {},
      enforce: (_request, execute) => execute(),
    }).send_email;
    expect(tool?.coaz).toBe(true);
  });
});

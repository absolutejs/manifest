import type {
  AdapterImplementation,
  AdapterSlot,
  ManifestDiscovery,
  ManifestIdentity,
  ToolAuthorization,
} from "./types";

export type DiscoverableManifest = {
  identity: ManifestIdentity;
  discovery?: ManifestDiscovery;
  slots?: Record<string, AdapterSlot>;
  implements?: ReadonlyArray<AdapterImplementation>;
  tools?: Record<
    string,
    {
      description: string;
      input: Record<string, unknown>;
      authorization?: ToolAuthorization;
    }
  >;
};

export type ManifestAgentCatalogEntry = {
  "@type": "SoftwareApplication";
  id: string;
  name: string;
  description: string;
  category: string;
  url?: string;
  docsUrl?: string;
  keywords: string[];
  intents: string[];
  protocols: string[];
  contracts: string[];
  tools: Array<{
    name: string;
    description: string;
    effects: string[];
    requiredScopes: string[];
    coaz: boolean;
  }>;
  certificationUrl?: string;
};

const words = (value: string) =>
  value
    .toLowerCase()
    .split(/[^a-z0-9@._/-]+/u)
    .filter((item) => item.length > 1);
const authorization = (value: ToolAuthorization | undefined) => ({
  effects: [...(value?.effects ?? [])],
  requiredScopes: [...(value?.requiredScopes ?? [])],
});

/** Deterministic package capability entry for registries, search, and RAG. */
export const manifestsToAgentCatalogJsonLd = (
  manifests: readonly DiscoverableManifest[],
  options: { id?: string; name?: string } = {},
) => ({
  "@context": "https://schema.org",
  "@id": options.id,
  "@type": "ItemList",
  itemListElement: manifests
    .map(manifestToAgentCatalogEntry)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((item, index) => ({ "@type": "ListItem", item, position: index + 1 })),
  name: options.name ?? "Agent capability catalog",
});
export const manifestsToAgentsText = (
  manifests: readonly DiscoverableManifest[],
) =>
  manifests
    .map(manifestToAgentCatalogEntry)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(
      (entry) =>
        `## ${entry.name}\n${entry.description}\nIntents: ${entry.intents.join(", ") || "none"}\nProtocols: ${entry.protocols.join(", ") || "none"}\nTools: ${entry.tools.map(({ name }) => name).join(", ") || "none"}\nDocs: ${entry.docsUrl ?? entry.url ?? "not published"}`,
    )
    .join("\n\n");
export const manifestToAgentCatalogEntry = (
  manifest: DiscoverableManifest,
): ManifestAgentCatalogEntry => {
  const tools = Object.entries(manifest.tools ?? {}).map(([name, tool]) => ({
    ...authorization(tool.authorization),
    coaz: "x-coaz-mapping" in tool.input,
    description: tool.description,
    name,
  }));
  const contracts = [
    ...Object.values(manifest.slots ?? {}).map(({ contract }) => contract),
    ...(manifest.implements ?? []).map(({ contract }) => contract),
  ].sort();
  const derivedKeywords = [
    ...words(manifest.identity.name),
    ...words(manifest.identity.tagline),
    ...words(manifest.identity.description ?? ""),
    ...tools.flatMap((tool) => [
      ...words(tool.name),
      ...words(tool.description),
      ...tool.effects,
    ]),
    ...contracts,
  ];

  return {
    "@type": "SoftwareApplication",
    category: manifest.identity.category,
    contracts,
    description: manifest.identity.description ?? manifest.identity.tagline,
    ...(manifest.identity.docsUrl
      ? { docsUrl: manifest.identity.docsUrl }
      : {}),
    id: manifest.identity.name,
    intents: [
      ...new Set(manifest.discovery?.intents ?? tools.map(({ name }) => name)),
    ].sort(),
    keywords: [
      ...new Set([...(manifest.discovery?.keywords ?? []), ...derivedKeywords]),
    ].sort(),
    name: manifest.identity.name,
    protocols: [...new Set(manifest.discovery?.protocols ?? [])].sort(),
    tools,
    ...(manifest.discovery?.url ? { url: manifest.discovery.url } : {}),
    ...(manifest.discovery?.certificationUrl
      ? { certificationUrl: manifest.discovery.certificationUrl }
      : {}),
  };
};

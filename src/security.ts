import type {
  AnyPackageManifest,
  ManifestTool,
  ToolAuthorization,
  ToolEffect,
} from "./types";

const HEX_RADIX = 16;

export type ManifestToolSecurityCode =
  | "compensation_invalid"
  | "destination_binding_missing"
  | "destructive_hint_missing"
  | "field_binding_invalid"
  | "idempotency_missing"
  | "legacy_tool_omitted"
  | "public_effect_forbidden"
  | "read_only_hint_invalid"
  | "resource_binding_missing"
  | "reversibility_missing"
  | "scope_missing"
  | "spend_binding_missing"
  | "tool_authorization_missing";

export type ManifestToolSecurityIssue = {
  code: ManifestToolSecurityCode;
  message: string;
  severity: "error" | "warning";
  toolName: string;
};

export type ManifestToolSecurityPosture = {
  approval: ToolAuthorization["approval"] | null;
  audience: ToolAuthorization["audience"] | null;
  effects: ReadonlyArray<ToolEffect>;
  issues: ReadonlyArray<ManifestToolSecurityIssue>;
  remotelyCallable: boolean;
  status: "guarded" | "invalid" | "legacy-omitted";
  toolName: string;
};

export type ManifestSecurityPosture = {
  issues: ReadonlyArray<ManifestToolSecurityIssue>;
  readyForRemoteTools: boolean;
  tools: ReadonlyArray<ManifestToolSecurityPosture>;
};

const effectful = (authorization: ToolAuthorization) =>
  authorization.effects.some((effect) => effect !== "read");

const hasAnyEffect = (
  authorization: ToolAuthorization,
  effects: ReadonlyArray<ToolEffect>,
) => effects.some((effect) => authorization.effects.includes(effect));

const inputFields = (tool: ManifestTool<unknown>) => {
  const properties = Reflect.get(tool.input, "properties");
  if (typeof properties !== "object" || properties === null)
    return new Set<string>();

  return new Set(Object.keys(properties));
};

const issue = (
  toolName: string,
  code: ManifestToolSecurityCode,
  message: string,
  severity: ManifestToolSecurityIssue["severity"] = "error",
): ManifestToolSecurityIssue => ({ code, message, severity, toolName });

const boundFields = (authorization: ToolAuthorization) => [
  ...(authorization.destinationFields ?? []),
  ...(authorization.idempotency?.mode === "field"
    ? [authorization.idempotency.field]
    : []),
  ...(authorization.resource?.idField ? [authorization.resource.idField] : []),
  ...(authorization.resource?.ownerIdField
    ? [authorization.resource.ownerIdField]
    : []),
  ...(authorization.resource?.tenantIdField
    ? [authorization.resource.tenantIdField]
    : []),
  ...(authorization.spend
    ? [authorization.spend.amountMinorField, authorization.spend.currencyField]
    : []),
];

const authorizedToolIssues = (
  manifest: AnyPackageManifest,
  toolName: string,
  tool: ManifestTool<unknown>,
  authorization: ToolAuthorization,
) => {
  const issues: ManifestToolSecurityIssue[] = [];
  const isEffectful = effectful(authorization);
  const fields = inputFields(tool);

  if (
    authorization.audience !== "public" &&
    (authorization.requiredScopes?.length ?? 0) === 0
  )
    issues.push(
      issue(
        toolName,
        "scope_missing",
        "Non-public tools must declare at least one required scope.",
      ),
    );
  if (
    authorization.audience === "public" &&
    (isEffectful || authorization.approval !== "never")
  )
    issues.push(
      issue(
        toolName,
        "public_effect_forbidden",
        "Public tools must be read-only and explicitly require no approval.",
      ),
    );
  if (isEffectful && authorization.idempotency === undefined)
    issues.push(
      issue(
        toolName,
        "idempotency_missing",
        "Effectful tools must declare how idempotency is bound.",
      ),
    );
  if (isEffectful && authorization.reversible === undefined)
    issues.push(
      issue(
        toolName,
        "reversibility_missing",
        "Effectful tools must explicitly declare whether they are reversible.",
      ),
    );
  if (authorization.reversible === true && !authorization.compensatingTool)
    issues.push(
      issue(
        toolName,
        "compensation_invalid",
        "Reversible tools must name their compensating tool.",
      ),
    );
  if (authorization.reversible === false && authorization.compensatingTool)
    issues.push(
      issue(
        toolName,
        "compensation_invalid",
        "An irreversible tool cannot declare a compensating tool.",
      ),
    );
  if (
    authorization.compensatingTool &&
    manifest.tools?.[authorization.compensatingTool] === undefined
  )
    issues.push(
      issue(
        toolName,
        "compensation_invalid",
        `Compensating tool "${authorization.compensatingTool}" is not declared by this manifest.`,
      ),
    );
  if (
    hasAnyEffect(authorization, ["external-network", "send"]) &&
    (authorization.destinations?.length ?? 0) === 0 &&
    (authorization.destinationFields?.length ?? 0) === 0
  )
    issues.push(
      issue(
        toolName,
        "destination_binding_missing",
        "Network and send effects must bind a fixed destination class or validated input field.",
      ),
    );
  if (
    hasAnyEffect(authorization, ["delete", "purchase", "transfer", "write"]) &&
    authorization.resource === undefined
  )
    issues.push(
      issue(
        toolName,
        "resource_binding_missing",
        "Write, delete, purchase, and transfer effects must declare their resource binding.",
      ),
    );
  if (authorization.effects.includes("purchase") && !authorization.spend)
    issues.push(
      issue(
        toolName,
        "spend_binding_missing",
        "Purchase effects must bind amount and currency fields.",
      ),
    );
  if (
    hasAnyEffect(authorization, ["delete", "purchase", "transfer"]) &&
    tool.annotations?.destructiveHint !== true
  )
    issues.push(
      issue(
        toolName,
        "destructive_hint_missing",
        "Delete, purchase, and transfer effects must be visibly marked destructive.",
      ),
    );
  if (!isEffectful && tool.annotations?.readOnlyHint !== true)
    issues.push(
      issue(
        toolName,
        "read_only_hint_invalid",
        "Read-only authorization must be paired with readOnlyHint: true.",
      ),
    );
  if (isEffectful && tool.annotations?.readOnlyHint === true)
    issues.push(
      issue(
        toolName,
        "read_only_hint_invalid",
        "Effectful tools cannot advertise readOnlyHint: true.",
      ),
    );
  for (const field of boundFields(authorization))
    if (!fields.has(field))
      issues.push(
        issue(
          toolName,
          "field_binding_invalid",
          `Authorization field "${field}" is not present in the tool input schema.`,
        ),
      );
  if (
    authorization.idempotency?.mode === "resource" &&
    !authorization.resource?.idField
  )
    issues.push(
      issue(
        toolName,
        "idempotency_missing",
        "Resource idempotency requires a resource idField.",
      ),
    );

  return issues;
};

export const inspectManifestSecurity = (
  manifest: AnyPackageManifest,
): ManifestSecurityPosture => {
  const tools = Object.entries(manifest.tools ?? {}).map(
    ([toolName, tool]): ManifestToolSecurityPosture => {
      if (manifest.contract === 1) {
        const issues = [
          issue(
            toolName,
            "legacy_tool_omitted",
            "Contract-1 tools are omitted from remote AI and MCP bridges.",
            "warning",
          ),
        ];

        return {
          approval: null,
          audience: null,
          effects: [],
          issues,
          remotelyCallable: false,
          status: "legacy-omitted",
          toolName,
        };
      }
      if (!tool.authorization) {
        const issues = [
          issue(
            toolName,
            "tool_authorization_missing",
            "Contract-2 tools must declare authorization metadata.",
          ),
        ];

        return {
          approval: null,
          audience: null,
          effects: [],
          issues,
          remotelyCallable: false,
          status: "invalid",
          toolName,
        };
      }
      const issues = authorizedToolIssues(
        manifest,
        toolName,
        tool,
        tool.authorization,
      );

      return {
        approval: tool.authorization.approval,
        audience: tool.authorization.audience,
        effects: tool.authorization.effects,
        issues,
        remotelyCallable: issues.length === 0,
        status: issues.length === 0 ? "guarded" : "invalid",
        toolName,
      };
    },
  );
  const issues = tools.flatMap((tool) => tool.issues);

  return {
    issues,
    readyForRemoteTools: tools.every((tool) => tool.remotelyCallable),
    tools,
  };
};

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new Error("Tool input must be finite JSON");

    return JSON.stringify(value);
  }
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value).filter(
      ([, item]) => item !== undefined,
    );

    return `{${entries
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }

  throw new Error("Tool input must be JSON serializable");
};

export const digestToolInput = async (value: unknown) => {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const hex = [...digest]
    .map((byte) => byte.toString(HEX_RADIX).padStart(2, "0"))
    .join("");

  return `sha256:${hex}` as const;
};

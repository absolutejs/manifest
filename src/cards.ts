import type { EnvRequirement } from "./types";

/* ─── Credential card bridge ─── */

/** Structurally satisfies @absolutejs/ai's CredentialKey. */
export type CredentialCardKey = {
  /** Environment variable name, e.g. 'STRIPE_SECRET_KEY'. */
  key: string;
  /** Human label — mapped from the requirement's description. */
  label?: string;
  /** Where to obtain the credential (provider dashboard URL). */
  docsUrl?: string;
  /** Mask + never echo. Always set explicitly by the bridge (default
   *  true when the requirement leaves it undefined — conservative). */
  secret?: boolean;
  /** Already configured on the host — render as set, offer replace. */
  isSet?: boolean;
};

/** Structurally satisfies @absolutejs/ai's CredentialSpec — the payload of
 *  its `request_credentials` UI card. Kept dependency-free on purpose, the
 *  same pattern as BridgedAITool / BridgedMcpTool; tests/cards.test.ts pins
 *  the assignability with a type-only import. */
export type CredentialCardSpec = {
  title: string;
  keys: CredentialCardKey[];
  /** Stable card identity: hosts replace an earlier render with the same
   *  cardId in place. */
  cardId?: string;
};

const DEFAULT_CREDENTIAL_CARD_TITLE = "Configure credentials";

const toCredentialCardKey = (
  requirement: EnvRequirement,
  isSet: (key: string) => boolean,
) => {
  const { description, docsUrl, key, secret } = requirement;
  const entry: CredentialCardKey = {
    isSet: isSet(key),
    key,
    // Conservative: an unspecified secret flag means secret.
    secret: secret !== false,
  };
  if (description) entry.label = description;
  if (docsUrl) entry.docsUrl = docsUrl;

  return entry;
};

/**
 * Map a manifest's env requirements onto @absolutejs/ai's credential-request
 * card shape (the `request_credentials` card). Values NEVER ride the card:
 * only key names, labels, docs links, and set-status — the host UI collects
 * the actual values outside the model loop. `secret` defaults to true when a
 * requirement leaves it undefined. `when`-gated requirements are included
 * as-is; callers pre-filter against their settings when they want only the
 * currently-active requirements.
 */
export const envRequirementsToCredentialCard = (
  requirements: ReadonlyArray<EnvRequirement>,
  isSet: (key: string) => boolean,
  options?: { title?: string; cardId?: string },
) => {
  const spec: CredentialCardSpec = {
    keys: requirements.map((requirement) =>
      toCredentialCardKey(requirement, isSet),
    ),
    title: options?.title ?? DEFAULT_CREDENTIAL_CARD_TITLE,
  };
  if (options?.cardId) spec.cardId = options.cardId;

  return spec;
};

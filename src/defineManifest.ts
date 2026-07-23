import type { Static, TSchema } from "@sinclair/typebox";
import type {
  AdapterImplementation,
  AuthorizedManifestTool,
  LegacyManifestTool,
  PackageManifest,
} from "./types";

type ExcessKeys<S extends TSchema, TConfig> = Exclude<
  keyof Static<S>,
  keyof TConfig
>;

/** Every property optional, recursively; functions and arrays pass through.
 *  Settings are checked against DeepPartial<TConfig> rather than
 *  Partial<TConfig> because config subtrees often mix serializable knobs
 *  with wiring-time material (an OAuth provider entry requires
 *  `credentials`, but credentials come from env at wiring time and must
 *  never appear in a settings schema). Key-name and value-type drift is
 *  still caught; only nested requiredness is relaxed — the conformance
 *  suite's runtime deep-key check covers that. */
type DeepPartial<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends ReadonlyArray<infer U>
    ? ReadonlyArray<DeepPartial<U>>
    : T extends object
      ? { [K in keyof T]?: DeepPartial<T[K]> }
      : T;

/** Resolves to `unknown` (intersection no-op) when the schema is a valid
 *  serializable deep-subset of TConfig; otherwise resolves to a descriptive
 *  error object that the schema literal cannot satisfy, so the package's own
 *  typecheck fails at its manifest module. This is the drift-breaker: rename
 *  or retype a config key without updating the manifest and `tsc` stops the
 *  package's build. Nested excess keys are the one soft spot (structural
 *  assignability permits them); the conformance suite's runtime deep-key
 *  check covers those. */
type ValidSettings<S extends TSchema, TConfig> =
  Static<S> extends DeepPartial<TConfig>
    ? ExcessKeys<S, TConfig> extends never
      ? unknown
      : {
          "settings schema declares keys that do not exist on the config type": ExcessKeys<
            S,
            TConfig
          >;
        }
    : {
        "settings schema values are not assignable to the config type — check nested shapes": true;
      };

/** Curried so TConfig/TRuntime are explicit while the settings schema is
 *  inferred — TypeScript has no partial inference in a single call.
 *
 *  ```ts
 *  export const manifest = defineManifest<DispatcherOptions, Dispatcher>()({
 *  	contract: 2,
 *  	identity: { ... },
 *  	settings: Type.Object({ ... }),  // checked against DispatcherOptions
 *  	wiring: [ ... ]
 *  });
 *  ```
 */
export const defineImplementation =
  <TOptions>() =>
  <S extends TSchema>(
    implementation: Omit<AdapterImplementation, "settings"> & {
      settings?: S & ValidSettings<S, TOptions>;
    },
  ) => {
    const defined: AdapterImplementation = implementation;

    return defined;
  };
export const defineManifest =
  <TConfig, TRuntime = never>() =>
  <S extends TSchema>(
    manifest: Omit<
      PackageManifest<TConfig, TRuntime>,
      "contract" | "settings" | "tools"
    > &
      (
        | {
            contract: 1;
            tools?: Record<string, LegacyManifestTool<TRuntime>>;
          }
        | {
            contract: 2;
            tools?: Record<string, AuthorizedManifestTool<TRuntime>>;
          }
      ) & {
        settings: S & ValidSettings<S, TConfig>;
      },
  ) =>
    manifest;

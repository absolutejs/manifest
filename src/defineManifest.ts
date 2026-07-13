import type { Static, TSchema } from '@sinclair/typebox';
import type { AdapterImplementation, PackageManifest } from './types';

type ExcessKeys<S extends TSchema, TConfig> = Exclude<
	keyof Static<S>,
	keyof TConfig
>;

/** Resolves to `unknown` (intersection no-op) when the schema is a valid
 *  serializable subset of TConfig; otherwise resolves to a descriptive error
 *  object that the schema literal cannot satisfy, so the package's own
 *  typecheck fails at its manifest module. This is the drift-breaker: rename
 *  or retype a config key without updating the manifest and `tsc` stops the
 *  package's build. Nested excess keys are the one soft spot (structural
 *  assignability permits them); the conformance suite's runtime deep-key
 *  check covers those. */
type ValidSettings<S extends TSchema, TConfig> =
	Static<S> extends Partial<TConfig>
		? ExcessKeys<S, TConfig> extends never
			? unknown
			: {
					'settings schema declares keys that do not exist on the config type': ExcessKeys<
						S,
						TConfig
					>;
				}
		: {
				'settings schema values are not assignable to the config type — check nested shapes': true;
			};

/** Curried so TConfig/TRuntime are explicit while the settings schema is
 *  inferred — TypeScript has no partial inference in a single call.
 *
 *  ```ts
 *  export const manifest = defineManifest<DispatcherOptions, Dispatcher>()({
 *  	contract: 1,
 *  	identity: { ... },
 *  	settings: Type.Object({ ... }),  // checked against DispatcherOptions
 *  	wiring: [ ... ]
 *  });
 *  ```
 */
export const defineManifest =
	<TConfig, TRuntime = never>() =>
	<S extends TSchema>(
		manifest: Omit<PackageManifest<TConfig, TRuntime>, 'settings'> & {
			settings: S & ValidSettings<S, TConfig>;
		}
	): PackageManifest<TConfig, TRuntime> =>
		manifest as PackageManifest<TConfig, TRuntime>;

/** Same drift-breaker for an adapter implementation's settings schema,
 *  checked against the factory's options type. Keys that are wired rather
 *  than configured (injected clients, callbacks) simply stay out of the
 *  schema — the subset check permits that.
 *
 *  ```ts
 *  defineImplementation<CreateResendAdapterOptions>()({
 *  	contract: 'dispatch/email-adapter',
 *  	settings: Type.Object({ defaultFrom: Type.Optional(Type.String()) }),
 *  	...
 *  });
 *  ```
 */
export const defineImplementation =
	<TOptions>() =>
	<S extends TSchema>(
		implementation: Omit<AdapterImplementation, 'settings'> & {
			settings?: S & ValidSettings<S, TOptions>;
		}
	): AdapterImplementation =>
		implementation as AdapterImplementation;

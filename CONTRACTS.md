# Adapter contract registry

Adapter slots and implementations are matched by **contract id** — a string of
the form `<domain>/<contract>`, where `<domain>` is the core package that owns
the contract type. Ids listed here are reserved by their domain packages;
third parties mint ids under their own namespace (`acme/foo-adapter`) without
coordination.

An `AdapterSlot` (declared by the core package) and an `AdapterImplementation`
(declared by an adapter package, or by the core package itself for built-ins)
compose when their `contract` strings are equal. Discovery is by scanning
installed manifests — publishing a new adapter never requires a core release.

## Reserved contract ids

| Contract id | Core package | Contract type | Known implementations |
| --- | --- | --- | --- |
| `audit/sink` | `@absolutejs/audit` | `AuditSink` | `#memory`, `#console`, `@absolutejs/audit-postgres`, `@absolutejs/audit-s3` |
| `auth/session-store` | `@absolutejs/auth` | session store | `@absolutejs/auth#postgres`, `@absolutejs/auth#redis` |
| `blob/store` | `@absolutejs/blob` | `BlobStore` | `@absolutejs/blob#local`, `@absolutejs/blob#s3` |
| `dispatch/email-adapter` | `@absolutejs/dispatch` | `EmailAdapter` | `@absolutejs/dispatch-resend`, `@absolutejs/dispatch-postmark` |
| `dispatch/push-adapter` | `@absolutejs/dispatch` | `PushAdapter` | — |
| `dispatch/sms-adapter` | `@absolutejs/dispatch` | `SmsAdapter` | `@absolutejs/dispatch-twilio` |
| `errors/issue-store` | `@absolutejs/errors` | `IssueStore` | `#memory`, `@absolutejs/errors-postgres` |
| `logs/sink` | `@absolutejs/logs` | `LogSink` | `#console-json`, `#console-pretty`, `#rotating-file` |
| `queue/job-store` | `@absolutejs/queue` | `JobStore` | `@absolutejs/queue#memory`, `@absolutejs/queue-postgres`, `@absolutejs/queue-redis` |
| `rate-limit/algorithm` | `@absolutejs/rate-limit` | rate-limit algorithm | `@absolutejs/rate-limit#gcra`, `#tokenBucket`, `#slidingWindow` |
| `rate-limit/store` | `@absolutejs/rate-limit` | rate-limit store | `@absolutejs/rate-limit#memoryStore` |
| `secrets/adapter` | `@absolutejs/secrets` | `SecretAdapter` | `#env`, `#memory`, `#encrypted-file` |
| `rag/vector-store` | `@absolutejs/rag` | `RAGVectorStore` | `@absolutejs/rag-pinecone`, `@absolutejs/rag-postgres`, `@absolutejs/rag-sqlite` |
| `voice/stt` | `@absolutejs/voice` | STT adapter | `@absolutejs/voice-*` (per vendor) |
| `voice/tts` | `@absolutejs/voice` | TTS adapter | `@absolutejs/voice-*` (per vendor) |

Add a row here when a core package declares a new slot. The conformance suite
checks that every `slot.known` entry resolves to a published package or a
same-package `#id` built-in.

## The placeholder grammar (contract v1 — frozen)

Wiring `code` templates and lifecycle `command` templates may use exactly four
placeholder forms. Consumers MUST reject templates containing `${...}`
sequences outside this grammar.

| Form | Expands to |
| --- | --- |
| `${settings}` | the configured settings object, as a source literal |
| `${settings.path}` | one settings value, serialized |
| `${env.KEY}` | a `process.env.KEY` **reference** — never the value |
| `${slot.name}` | the expanded wiring of the adapter chosen for slot `name` |

Anything richer waits for `contract: 2`.

## Known v1 limitations (contract: 2 candidates)

Real friction found while authoring manifests — worked around by convention
today, candidates for first-class support in the next contract version:

1. **User-defined bindings in wiring.** An adapter snippet sometimes needs a
   binding the HOST recipe declares (queue's stores need the app's `jobs`
   definition from `defineJobs`). v1 convention: the core recipe declares a
   module-scope binding with a documented name and adapter snippets reference
   it textually. Candidate: a `${binding.name}` placeholder with declared
   bindings in the recipe.
2. **Composite runtimes.** Some packages construct several cooperating pieces
   rather than one instance (rate-limit's algorithm + store). v1 convention:
   TRuntime is a structural object of the pieces. Candidate: named runtime
   bindings.
3. **Non-command migrations.** Some lifecycle steps are code changes, not
   commands (queue-postgres: extend your Drizzle schema + `drizzle-kit
   push`). v1 convention: a step with no `command`, `when:
   'before-first-run'`, docsUrl. Candidate: a `kind: 'code-change'` step
   with a wiring snippet.
4. **`LifecycleStep.description`** does not exist; how-to copy gets crammed
   into `title` + docsUrl.
5. **No multi-instance slots.** `logs.sinks` / `audit.sinks` are arrays, but a
   slot resolves to ONE adapter — fan-out (console + Postgres + S3 together)
   is inexpressible. Candidate: `multiple: true` slots expanding to an array.
6. **No cross-package instance placeholder.** Options like `errors.audit` or
   audit-elysia's `audit` consume another package's wired instance; v1 uses a
   TODO-comment free variable. Candidate: `${instance('@absolutejs/audit')}`.
7. **`WiringImport` can't express default imports** (forced `neon` over
   `postgres` in Postgres adapter wirings). Candidate: `default: true` on
   imports.
8. **`PeerRequirement` has no `optional` flag** and requirements can't be
   scoped to a wiring recipe.

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
| `auth/session-store` | `@absolutejs/auth` | session store | `@absolutejs/auth#postgres`, `@absolutejs/auth#redis` |
| `blob/store` | `@absolutejs/blob` | `BlobStore` | `@absolutejs/blob#local`, `@absolutejs/blob#s3` |
| `dispatch/email-adapter` | `@absolutejs/dispatch` | `EmailAdapter` | `@absolutejs/dispatch-resend`, `@absolutejs/dispatch-postmark` |
| `dispatch/push-adapter` | `@absolutejs/dispatch` | `PushAdapter` | — |
| `dispatch/sms-adapter` | `@absolutejs/dispatch` | `SmsAdapter` | `@absolutejs/dispatch-twilio` |
| `queue/job-store` | `@absolutejs/queue` | `JobStore` | `@absolutejs/queue-postgres`, `@absolutejs/queue-redis` |
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

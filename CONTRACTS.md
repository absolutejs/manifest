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

| Contract id                  | Core package             | Contract type            | Known implementations                                                                                      |
| ---------------------------- | ------------------------ | ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `audit/sink`                 | `@absolutejs/audit`      | `AuditSink`              | `#memory`, `#console`, `@absolutejs/audit-postgres`, `@absolutejs/audit-s3`                                |
| `auth/session-store`         | `@absolutejs/auth`       | session store            | `@absolutejs/auth#postgres`, `@absolutejs/auth#redis`                                                      |
| `blob/store`                 | `@absolutejs/blob`       | `BlobStore`              | `@absolutejs/blob#local`, `@absolutejs/blob#s3`                                                            |
| `commerce/email-provider`    | `@absolutejs/commerce`   | receipt email provider   | `@absolutejs/commerce-resend`                                                                              |
| `commerce/payment-provider`  | `@absolutejs/commerce`   | payment provider         | `@absolutejs/commerce-stripe`                                                                              |
| `commerce/shipping-provider` | `@absolutejs/commerce`   | shipping provider        | `@absolutejs/commerce-easypost`                                                                            |
| `crm/local-entity-store`     | `@absolutejs/crm`        | local entity store       | `#memory`, `#postgres`                                                                                     |
| `crm/sync-queue`             | `@absolutejs/crm`        | sync queue               | `#memory`, `#postgres`                                                                                     |
| `crm/token-store`            | `@absolutejs/crm`        | token store              | `#memory`, `#postgres`                                                                                     |
| `dispatch/email-adapter`     | `@absolutejs/dispatch`   | `EmailAdapter`           | `@absolutejs/dispatch-resend`, `@absolutejs/dispatch-postmark`                                             |
| `dispatch/push-adapter`      | `@absolutejs/dispatch`   | `PushAdapter`            | —                                                                                                          |
| `discover/dataset-source`    | `@absolutejs/discover`   | `DatasetSource`          | `@absolutejs/dataset-gleif`, `@absolutejs/dataset-sec-edgar`, `@absolutejs/dataset-github`                 |
| `dispatch/messaging-adapter` | `@absolutejs/dispatch`   | `MessagingAdapter`       | `@absolutejs/dispatch-telnyx`, `@absolutejs/dispatch-twilio`                                               |
| `outcomes/store`             | `@absolutejs/outcomes`   | outcome store            | `#memory`                                                                                                  |
| `rules/store`                | `@absolutejs/rules`      | rule store               | `#memory`                                                                                                  |
| `errors/issue-store`         | `@absolutejs/errors`     | `IssueStore`             | `#memory`, `@absolutejs/errors-postgres`                                                                   |
| `logs/sink`                  | `@absolutejs/logs`       | `LogSink`                | `#console-json`, `#console-pretty`, `#rotating-file`                                                       |
| `meeting/source`             | `@absolutejs/meeting`    | meeting source           | `#buffer`, `@absolutejs/meeting-recall`, `@absolutejs/meeting-discord`                                     |
| `metering/sink`              | `@absolutejs/metering`   | metering sink            | `#console`                                                                                                 |
| `onchain/adapters`           | `@absolutejs/onchain`    | chain adapters           | `#local`, `@absolutejs/onchain-base`                                                                       |
| `queue/job-store`            | `@absolutejs/queue`      | `JobStore`               | `@absolutejs/queue#memory`, `@absolutejs/queue-postgres`, `@absolutejs/queue-redis`                        |
| `rate-limit/algorithm`       | `@absolutejs/rate-limit` | rate-limit algorithm     | `@absolutejs/rate-limit#gcra`, `#tokenBucket`, `#slidingWindow`                                            |
| `rate-limit/store`           | `@absolutejs/rate-limit` | rate-limit store         | `@absolutejs/rate-limit#memoryStore`                                                                       |
| `secrets/adapter`            | `@absolutejs/secrets`    | `SecretAdapter`          | `#env`, `#memory`, `#encrypted-file`                                                                       |
| `sync/cluster-bus`           | `@absolutejs/sync`       | cluster bus              | `#memory-bus`, `@absolutejs/sync-bus-pg`, `@absolutejs/sync-bus-redis`                                     |
| `sync/crdt-adapter`          | `@absolutejs/sync`       | CRDT adapter             | `#rga-text`, `@absolutejs/sync-yjs`, `@absolutejs/sync-automerge`, `@absolutejs/sync-loro`                 |
| `rag/embedding-provider`     | `@absolutejs/rag`        | `RAGEmbeddingProvider`   | `#openai`, `#gemini`, `#ollama`                                                                            |
| `rag/reranker`               | `@absolutejs/rag`        | `RAGRerankerProvider`    | `#heuristic`, `#cohere`, `#voyage`, `#jina`                                                                |
| `rag/vector-store`           | `@absolutejs/rag`        | `RAGVectorStore`         | `@absolutejs/rag#memory`, `@absolutejs/rag-pinecone`, `@absolutejs/rag-postgres`, `@absolutejs/rag-sqlite` |
| `voice/realtime`             | `@absolutejs/voice`      | speech-to-speech adapter | `@absolutejs/voice-gemini`, `@absolutejs/voice-openai`                                                     |
| `voice/session-store`        | `@absolutejs/voice`      | session store            | `#memory`, `#sqlite`, `#postgres`, `#json-file`                                                            |
| `voice/stt`                  | `@absolutejs/voice`      | STT adapter              | assemblyai, azure, deepgram, gladia, google-speech, openai-whisper, soniox, speechmatics                   |
| `voice/tts`                  | `@absolutejs/voice`      | TTS adapter              | azure, cartesia, elevenlabs, lmnt, neets, playht, rime, smallest                                           |

Add a row here when a core package declares a new slot. The conformance suite
checks that every `slot.known` entry resolves to a published package or a
same-package `#id` built-in.

## The placeholder grammar (contract v1 — frozen)

Wiring `code` templates and lifecycle `command` templates may use exactly four
placeholder forms. Consumers MUST reject templates containing `${...}`
sequences outside this grammar.

| Form               | Expands to                                                |
| ------------------ | --------------------------------------------------------- |
| `${settings}`      | the configured settings object, as a source literal       |
| `${settings.path}` | one settings value, serialized                            |
| `${env.KEY}`       | a `process.env.KEY` **reference** — never the value       |
| `${slot.name}`     | the expanded wiring of the adapter chosen for slot `name` |

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
9. **Method-call and per-field slots.** Some adapters are consumed by a
   method call or a field map (`engine.connectCluster(bus)`,
   `registerCrdt(table, {field})`) rather than a config path; `$self` only
   approximately fits. Candidate: a `$call`-style configPath marker or
   recipe-scoped slots.
10. **No recipe dependencies.** A recipe that rides another (sync's
    collaborative-text rides engine) declares it by comment convention only.
11. **No feature-pack composition.** Packs that extend a host package
    (sync-packs) compose by category + binding convention; an
    `extends`/`packs` field would make pack discovery first-class.
12. **Optional slots are all-or-nothing per recipe** (no conditional slot
    lines), and mutually exclusive slot groups (voice's stt+tts XOR realtime)
    are prose-only. Worked around with named recipe variants.
13. **Union-typed factory options.** One settings schema can't span both
    arms of a union options type (Deepgram's Conversational|Transcription);
    the implementation pins one arm. Offering both needs two implementations
    of the same factory.
14. **Factory-map config.** Some config values are factory _symbols_, not
    instances (crm's `adapters: Partial<Record<Vendor, Factory>>`) — neither
    slots (instance expressions) nor settings fit. Distinct from #9.
15. **Instance-valued built-ins.** `AdapterImplementation.factory` says
    "exported factory symbol", but some built-ins are plain exported
    instances (metering's `consoleSink`) — the field name lies for that
    case; wiring code is the bare symbol.
16. **Multi-factory packages have no shared options type** (pwa's three
    independent factories) — authors invent a local composite TConfig to
    keep the drift check. Needs a documented convention or first-class
    multi-config.
17. **`${...}` collides with generated template literals** (replay's upload
    URL) — no escape form; authors emit string concatenation. Candidate:
    `$${...}` escape in contract 2.
18. **No lifecycle-only integration shape.** renown (CLI + GitHub Action
    product) legitimately ships `wiring: []` + lifecycle steps; contract-
    valid, but consumers expecting a `default` recipe render nothing.
19. **Injected host-capability functions** (generateObject/embed/search
    across the intelligence family; mcp's `authorize`) are only expressible
    as TODO-throwing stubs — the function-shaped sibling of #6.
20. **Per-call-options packages have no natural TConfig** (rules, outcomes)
    — authors drift-check against the nearest meaningful type
    (`RuleFirePolicy`, a `Parameters<>[n]` extract). Undocumented convention.
21. **d.ts-less packages** (renown is noEmit/bin-only) ship `./manifest`
    without types; the contract assumes a declarations pipeline.

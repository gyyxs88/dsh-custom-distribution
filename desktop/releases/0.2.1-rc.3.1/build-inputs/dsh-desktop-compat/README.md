# Desktop 0.2.1-rc.2 compatibility supplement

External supplemental bundle `0.2.1-rc.2.2` for official DSH `0.2.1-rc.2`.
It replaces `dsh-desktop-opencode-session`. Cordis, LLM, pi-ai adapter and native
DeepSeek adapter entry sources are gated by exact reviewed version and SHA-256.
An upstream change requires review before activation.

The plugin wraps instances, never prototypes or global fetch:

* `PiAiAdapter.streamWithSnapshot` retains captured generations, clones only the
  selected Go profile and overwrites both identity headers with the dispatch SID.
  Main and prepared/title calls share the boundary. Terminal provider failures
  are corrected before the official runtime, persistence and retry hook.
* `DeepSeekAdapter.generate` covers native main and prepared calls, including
  the official account provider. It reads native LlmError status and complete
  JSON cause before normalization loses those facts. Account token rejection and
  ACCOUNT_QUOTA semantics remain owned by the official provider.
* `DeepSeekFileStore.client` returns an instance facade over the official
  `DeepSeekFilesClient.request` and its injectable transport. Failed response
  JSON is bounded to 64 KiB. Billing, authentication, region and permission
  failures bypass storage cleanup. Only proven storage/file-count exhaustion
  retains the official error identity for its existing bounded cleanup/reupload.
  The official native image request may still fall back to inline images after
  upload failure; this supplement does not change that recovery.
* `llm.discoverModels` retains live-first discovery in the standard `llm-pi-ai`
  namespace for providers with an installed catalog, lazy credentials, stored
  headers and safe static-catalog fallback. Providers without a catalog use the
  official live discovery unchanged. Official 0.2.1-rc.2 still chooses the static
  catalog before a supplied endpoint, and still conflates some 403 failures with
  invalid API keys; neither gap is retired on the basis of a similar feature name.

Classification trusts actual status fields and anchored SDK HTTP envelopes.
Numbers in body text and numeric provider `error.code` never become HTTP status.
Complete code/type/details.error_code and metadata.limit_source use explicit
allowlists. Known region and message-only rate errors use exact sentences;
arbitrary mentions of countries, keys or budgets do not establish a reason.
OpenRouter in-flight spending budget is transient; permanent balance, credits,
budget and spend-limit failures are QUOTA. Ordinary 403 is FORBIDDEN. Generic
authentication failure is AUTHENTICATION_FAILED; explicit invalid API keys retain
AUTH and the official accurate invalid-key UI. Fixed category summaries exclude
provider bodies, URLs, credentials, metadata and causes. Status, safe request ID,
retry delay, image-offload facts and cancellation are retained when available.

Normal retry remains official: RATE_LIMIT/SERVER/TIMEOUT/TRANSPORT are eligible;
QUOTA/REGION_RESTRICTED/FORBIDDEN/AUTH/AUTHENTICATION_FAILED are outside the default
retryable codes. Explicit `mode: always` retains its official semantics, including
retrying permanent failures. No retry loop, policy override or profile edit is
added. `network_error` remains TRANSPORT. Previously discarded upstream facts
cannot be reconstructed: native SSE can lose structured type/metadata, Responses
SSE can retain only type/message, Chat SSE can retain only message, and pi-ai can
discard HTTP retry headers/request IDs. Available facts are preserved; absent
ones are not invented.

Adapter updates attach new official instances. Disposal restores original own
descriptors without overwriting a later extension. Already started operations
retain their captured generation; disposal does not cancel them. Historical
records, models, provider choices, ASAR and dependencies are unchanged.

Discovery supports OpenAI completions/responses and Anthropic listings, 4 MiB
bounded bodies, OpenRouter input metadata and Accept-Encoding: identity. Safe
fallback requires a nonempty official catalog and a recognized connection/timeout
cause or HTTP 500-599. Authentication, rate limits, malformed replies, invalid
URLs/keys and cancellation do not permit fallback.

`scripts/*Desktop.mjs` build a deterministic seven-member TGZ and run real ASAR
adapters, native/account providers, Files uploads and official retry hooks against
loopback fixtures in isolated Electron Node mode. Production installation follows
the main controller's candidate gate and independent official UI acceptance.

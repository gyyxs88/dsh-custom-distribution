# Desktop rc.2 compatibility supplement

External supplemental bundle for the reviewed official DSH `0.2.0-rc.2` installation.
It replaces `dsh-desktop-opencode-session`; remove that bundle before enabling this one.
The exact official Cordis/LLM/pi-ai versions and entry source SHA-256 values are
checked at activation. Any upstream change requires a new review and release.

The plugin wraps **instances**, never prototypes or global fetch:

* Official `PiAiAdapter.streamWithSnapshot`: clone only the selected Go profile
  and its headers, overwrite both identity headers using the dispatch SID, retain
  captured models and other profiles; map only terminal `PI_AI_ERROR` containing
  the exact word `network_error` to `TRANSPORT`. Official retry owns recovery.
* Official LLM service `discoverModels`: for the standard `llm-pi-ai` settings
  namespace, query explicit endpoints first. Provider-only prefetch and fallback
  read the original official catalog, including its input capabilities. Lazy keys
  and stored headers come from the route's official adapter snapshot. Draft keys
  override storage. Other namespaces retain the original service method.

Discovery supports OpenAI completions/responses and Anthropic messages listings,
4 MiB bounded bodies, OpenRouter text/image metadata, and `Accept-Encoding: identity`.
Fallback requires a nonempty official catalog and a recognized TypeError cause
connection/timeout code or HTTP 500–599. Authentication/rate limits, bad JSON,
bad list shapes, invalid URLs/keys and cancellation never permit fallback.
Unsupported listing protocols can prefetch an existing catalog after URL validation.
No redirect, pagination or custom retry policy is added beyond native fetch behavior.

No production files, ASAR, dependencies, settings or credentials are modified.
Adapter updates attach new official instances. Disposal restores original property
descriptors without overwriting a later extension. Already started operations retain
their captured generation; disposal is not a cancellation mechanism.

Formal distribution commands live in `desktop/` and `scripts/*Desktop.mjs` in the
distribution repository. They test real rc.2 ASAR exports with Electron Node mode
and loopback HTTP using in-memory mock credentials, then create a deterministic TGZ.
Production installation and independent acceptance belong to the main controller.

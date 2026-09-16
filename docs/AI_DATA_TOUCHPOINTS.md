# AI Data Touchpoints — where the product sends data to external AI

**Purpose:** an exact map of every place the application calls an external AI service (Anthropic/Claude for language, Voyage for embeddings), what data each call sends, and whether that data is sensitive (unredacted private/PII) or safe (config/public/cleared). This is (a) the target list for a hybrid on-premise AI architecture, and (b) a ready answer to a prospect's "where does your AI see our data?"

Audited 2026-07-05.

## Key finding
**The core redaction workflow uses NO cloud AI.** Mass redaction is template / field-map / manual (deterministic). The AI touchpoints on real documents are all **optional assist** features. So a strict city can run actual redaction with zero cloud AI today by not using the assist features. The sensitive AI surface is small, identifiable, and mostly optional.

## In-app view
This audit is presented interactively at **Administration → Settings and Configuration → AI configuration (the Deployment Model and AI Touchpoints Information tabs)**, where each touchpoint's **"View code"** reads the real source live from the running codebase, and the routing column updates with the selected deployment profile (Standard / Government / Air-gapped). This document is the matching leave-behind.

## SENSITIVE — Claude/Voyage sees content that can contain private records
| Touchpoint | File / function | What it sends | Core/Optional | Routes to (Standard → Government) |
|---|---|---|---|---|
| Redaction zone discovery | `services/zoneDiscovery.js → discoverZones()` | Full **unredacted** document page text | Optional assist | Claude commercial → **Claude · Bedrock GovCloud** |
| Intake document extraction | `routes/extract.js` | Raw uploaded request letter (PDF/image) | Optional | Claude commercial → **Claude · Bedrock GovCloud** |
| Source schema discovery | `services/schemaDiscovery.js` | Sample rows/text from a source system | Optional (setup) | Claude commercial → **Claude · Bedrock GovCloud** |
| Search relevance judge | `services/recordSearch.js → judgeResults()` | Titles + summaries of candidate records | Core | Claude commercial → **Claude · Bedrock GovCloud** |
| Request classification & routing | `services/classifier.js` | The requestor's own request description (low sensitivity) | Core | Claude commercial → **Claude · Bedrock GovCloud** |
| Connector catalog (Laserfiche/Axon/Tyler) | `services/connectors/*.js` | Record metadata (titles, series) (low sensitivity) | Core (if used) | Claude commercial → **Claude · Bedrock GovCloud** |
| Document-page embeddings | `services/embedIndex.js` → Voyage | Document page text (can be unredacted) | Core (internal index) | Voyage → **Amazon Titan · Bedrock GovCloud** |

## SAFE — no unredacted private content (stays on commercial services even under Government)
| Touchpoint | File / function | What it sends | Core/Optional | Routes to (Standard → Government) |
|---|---|---|---|---|
| Record metadata extraction | `services/recordMetaExtract.js` | **Cleared** (post-redaction, public) record text | Core | Claude commercial → Claude commercial (no records) |
| AI reporting | `services/reportAgent.js` | Only the user's question; code computes the numbers | Optional | Claude commercial → Claude commercial (no records) |
| AI help assistant | `services/helpAgent.js` | User's question + a curated app description | Optional | Claude commercial → Claude commercial (no records) |
| Fee / rule / policy configuration | `services/feePolicyExtract.js`, `configExtractors.js`, `ruleDiscovery.js` | Policy / statute / fee-schedule documentation | Optional (setup) | Claude commercial → Claude commercial (no records) |
| Taxonomy / workflow authoring | `routes/taxonomy.js`, `workflow.js`, `repositories.js` | Admin-provided config text | Optional (setup) | Claude commercial → Claude commercial (no records) |
| Public portal assistant | `routes/publicChat.js` | Citizen query + **published** record metadata | Core | Claude commercial → Claude commercial (no records) |
| Public library semantic search | `services/recordSearch.js` (searchPublicReady) + Voyage | **Published** record text + the search query | Core | Voyage → Voyage (published data only) |

**Prompt-injection note:** what is "public" is filtered in **code** (a `published = 1` SQL clause), not by the LLM's discretion — so the public agent cannot be prompt-injected into surfacing non-public records (it never had access). The report agent uses a **bounded spec** (code runs the query), another injection guard. Residual surface = indirect injection via document content (zone discovery / extraction). Full pass deferred with the two-stage gatekeeper (BACKLOG).

## Hybrid on-premise AI — the path (see BACKLOG R6)
1. **Model-routing layer:** tag each AI call with a sensitivity class. A per-deployment setting routes sensitive tasks to a self-hosted open-weight model (OpenAI-compatible endpoint: vLLM / Ollama serving Llama/Qwen/Mistral) and everything else to Claude.
2. **Self-hostable embedding model** for the sensitive (document-page) index, replacing Voyage there; keep Voyage for the public-library index if acceptable.
3. **Deployment profiles:** *Standard* = all Claude/Voyage (most cities, whose requirement is data-storage-location). *Strict* = sensitive slice in-firewall (open-weight + local embeddings), rest on Claude. *Air-gapped* = all local.
4. **Cheapest strict option:** simply **disable** the optional sensitive assist features (intake extraction, zone discovery) and run manual redaction — near-zero cloud exposure without a local model.

## Honest tradeoffs
- The sensitive tasks (document extraction, zone discovery) are the **hardest**, so a weaker local model hurts most there — but they're optional assists, so disabling is a viable fallback.
- Classification and the internal search judge are **core** and sensitive-ish; these are the ones that most need a good local model in a strict deployment.
- Verify per prospect: "records STORED on our servers" (Standard profile satisfies) vs. "NO data leaves our network" (Strict/Air-gapped). Most mean the former.

## AI call log and the classifier's prompt cache `[BUILT 2026-09-16 — verify_ai_calls 15/15]`
**One door to the model.** Every application call to Claude goes through `services/aiClient.clientFor(caller)`, which returns the SDK's
`messages.create` shape (call sites unchanged) and logs one row per call to `ai_calls`: caller (`service:function`), model, the usage
the API reports (`input_tokens` · `cache_creation_input_tokens` · `cache_read_input_tokens` · `output_tokens`), duration, ok/error, the
API message id, an optional short context tag. Never the prompt or the answer. 25 call sites in 21 files; the only raw SDK client left
is `routes/integrations.js` (it tests a key the user just typed). `GET /api/ai-usage?days=N` (system_admin) aggregates by caller and
by day; the AI configuration screen has an **AI Usage** tab. Purpose: the platform usage report's *application key* is now explainable
feature by feature, and prompt caches can be verified from `cache_read_input_tokens`.
**Classifier prompt cache.** `classifier.buildPrompt` puts the stable part — instructions, the record-type catalog (~6k tokens on
Sonnet 5's tokenizer), the department list, the JSON shape — into ONE system block marked `cache_control: {type:'ephemeral'}` (5-minute
TTL); only the request text rides in the user message, after the breakpoint. Sonnet 5 caches prefixes ≥ 1,024 tokens. Live proof
2026-09-16: first classification `cache_creation_input_tokens 5977`, the next one `cache_read_input_tokens 5977` with 38 fresh input
tokens. Where it pays: bursts — the test suites (dozens of submissions in minutes) and intake spikes; a lone submission hours after the
last one still writes the cache (1.25× on that block) and reads nothing. `aiClient._setCacheTtl('1h')` switches to hour-long entries
(2× write price) if live submissions turn out to cluster 5–60 minutes apart — decide from the AI Usage tab, not in advance.

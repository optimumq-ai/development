# AI Data Touchpoints — where the product sends data to external AI

**Purpose:** an exact map of every place the application calls an external AI service (Anthropic/Claude for language, Voyage for embeddings), what data each call sends, and whether that data is sensitive (unredacted private/PII) or safe (config/public/cleared). This is (a) the target list for a hybrid on-premise AI architecture, and (b) a ready answer to a prospect's "where does your AI see our data?"

Audited 2026-07-05.

## Key finding
**The core redaction workflow uses NO cloud AI.** Mass redaction is template / field-map / manual (deterministic). The AI touchpoints on real documents are all **optional assist** features. So a strict city can run actual redaction with zero cloud AI today by not using the assist features. The sensitive AI surface is small, identifiable, and mostly optional.

## SENSITIVE — Claude/Voyage sees unredacted private content
| Touchpoint | File | What it sends | Core or optional | Notes |
|---|---|---|---|---|
| Intake document extraction | `routes/extract.js` | The raw uploaded request letter (PDF/image, base64) | Optional convenience | Extracts requestor name/email/phone/description. Sees requestor PII. |
| AI redaction-zone discovery | `services/zoneDiscovery.js` (via `routes/redactionJobs.js`) | Full **unredacted** document page text | Optional assist | Suggests what to redact by reading the whole record. The clearest sensitive case. Already found unreliable; manual is the default. |
| Schema discovery | `services/schemaDiscovery.js` | Sample rows/text from a real source system (~14k chars) | Optional (setup) | If samples contain real PII, sensitive. Used during source configuration. |
| Internal search relevance judge | `services/recordSearch.js` | Snippets from live-system search results | Core (staff search) | Snippets can be unredacted for internal/staff search. Public-library judging is on published records (safe). |
| Request classification/routing | `services/classifier.js` | The requestor's own request description | Core | Low sensitivity — the requestor's words, not the records. |
| Live-system connectors | `connectors/{laserfiche,axon,tyler}.js` | Record **metadata** (titles, series) from the connected system | Core (if used) | Metadata, not full content; moderate. |
| Document-page embeddings | `services/embedIndex.js` → Voyage | Document page text (can be unredacted) | Core (internal index) | Egress to Voyage, not Claude. Needs a self-hostable embedding model for strict deployments. |

## SAFE — no unredacted private content
| Touchpoint | File | What it sends |
|---|---|---|
| Help assistant | `services/helpAgent.js` | User's how-to question + curated app description |
| AI reporting | `services/reportAgent.js` | Only the natural-language question; code computes the numbers from the DB |
| Fee/estimate/policy config | `services/feePolicyExtract.js`, `configExtractors.js` | Policy/statute/fee-schedule documentation |
| Redaction-rule discovery | `services/ruleDiscovery.js` | Legal exemption/policy text |
| Taxonomy / workflow / connector authoring | `routes/taxonomy.js`, `workflow.js`, `repositories.js` | Admin-provided config text |
| Record metadata extraction | `services/recordMetaExtract.js` | **Cleared** (post-redaction, public) record text |
| Public portal agent | `routes/publicChat.js` | Citizen queries + **published** record metadata |
| Public library semantic search | `services/recordSearch.js` (searchPublicReady) + Voyage | **Published** record text only |

## Hybrid on-premise AI — the path (see BACKLOG R6)
1. **Model-routing layer:** tag each AI call with a sensitivity class. A per-deployment setting routes sensitive tasks to a self-hosted open-weight model (OpenAI-compatible endpoint: vLLM / Ollama serving Llama/Qwen/Mistral) and everything else to Claude.
2. **Self-hostable embedding model** for the sensitive (document-page) index, replacing Voyage there; keep Voyage for the public-library index if acceptable.
3. **Deployment profiles:** *Standard* = all Claude/Voyage (most cities, whose requirement is data-storage-location). *Strict* = sensitive slice in-firewall (open-weight + local embeddings), rest on Claude. *Air-gapped* = all local.
4. **Cheapest strict option:** simply **disable** the optional sensitive assist features (intake extraction, zone discovery) and run manual redaction — near-zero cloud exposure without a local model.

## Honest tradeoffs
- The sensitive tasks (document extraction, zone discovery) are the **hardest**, so a weaker local model hurts most there — but they're optional assists, so disabling is a viable fallback.
- Classification and the internal search judge are **core** and sensitive-ish; these are the ones that most need a good local model in a strict deployment.
- Verify per prospect: "records STORED on our servers" (Standard profile satisfies) vs. "NO data leaves our network" (Strict/Air-gapped). Most mean the former.

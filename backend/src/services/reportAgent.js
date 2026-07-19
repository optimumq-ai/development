'use strict';
// NL -> bounded report SPEC translator. The model ONLY chooses from the catalog (metrics, groupings,
// time presets, filters); it never writes SQL. reportEngine then computes the numbers deterministically.
const Anthropic = require('@anthropic-ai/sdk');
var reportEngine = require('./reportEngine');

var SPEC_SCHEMA = [
  'Translate the question into a JSON report spec. Return ONLY the JSON object - no prose, no markdown fences.',
  '{',
  '  "metric": one of [request_count, fee_revenue, overdue_count, avg_processing_days, compliance_rate, self_service_rate],',
  '  "group_by": one of [month, department, classification, status, requestor] or null,',
  '  "time_range": { "preset": one of [all, ytd, this_month, last_month, last_7d, last_30d, last_60d, last_90d, last_12_months] },',
  '  "filters": { "status": "active|closed|all" (optional), "classification": "simple|standard|complex|redaction_required" (optional), "overdue": true (optional) },',
  '  "sort": "desc|asc" (optional), "limit": number (optional, for top-N lists),',
  '  "compare": "this_vs_last_month" (optional),',
  '  "viz": one of [line, bar, table, number] (optional)',
  '}',
  'Guidance:',
  '- Pick the single best metric. "how many requests" -> request_count. "fee/revenue/money collected" -> fee_revenue. "overdue/late/past deadline" -> overdue_count. "how long/processing time/turnaround" -> avg_processing_days. "compliance/on time/met deadline" -> compliance_rate. "self-service/library/portal downloads vs requests" -> self_service_rate.',
  '- "by month" / "over time" / "trend" -> group_by month, viz line.',
  '- "by department", "by category" -> group_by department or classification (category maps to classification). viz bar.',
  '- fee_revenue by department or classification IS available. Each payment is split across the records it covers in proportion to their charged share, so the columns sum to the total. (This was refused before 2026-07-19, when there was no per-record price to split by.)',
  '- "top requestors / who submitted the most" -> metric request_count, group_by requestor, sort desc, limit (default 10), viz table.',
  '- "this month vs last month" -> compare this_vs_last_month.',
  '- Map time phrases to the nearest preset (e.g. "past 60 days" -> last_60d, "year to date" -> ytd, "this month" -> this_month).',
  '- If the question cannot be answered from this catalog, return {"error":"<one short sentence saying what is not supported and suggest a rephrase>"}.'
].join('\n');

function client() { return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }); }

async function ask(question) {
  var q = String(question || '').slice(0, 500).trim();
  if (!q) return { error: 'Please enter a question.' };
  var msg = await client().messages.create({ model: 'claude-sonnet-4-5', max_tokens: 400,
    system: 'You translate a plain-English question about a city public-records (FOIA) program into a bounded report spec.\n\n' + SPEC_SCHEMA,
    messages: [{ role: 'user', content: q }] });
  var text = (msg.content && msg.content[0] && msg.content[0].text ? msg.content[0].text : '').trim().replace(/```json|```/g, '').trim();
  var spec;
  try { spec = JSON.parse(text); } catch (e) { return { error: 'I could not interpret that question. Try rephrasing - for example, "requests by month this year" or "overdue requests by department".' }; }
  if (spec && spec.error) return { error: spec.error };
  try {
    var result = await reportEngine.run(spec);
    result.spec = spec; result.question = q;
    return result;
  } catch (e) { console.error('[reportAgent.run]', e && e.message); return { error: 'Something went wrong running that report.' }; }
}
module.exports = { ask: ask };

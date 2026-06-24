// AI fee-policy extraction. Reads a city's fee ordinance/policy text and proposes a fee config
// (same shape the deterministic engine consumes) WITH per-field citations + confidence. This is the
// "AI configures" half of the architecture: a human reviews and approves the proposal on the Fee
// Configuration screen; the engine then computes deterministically from the approved config. The AI
// is never in the runtime calculation path.
var Anthropic = require('@anthropic-ai/sdk');

function buildPrompt(text, context) {
  var ctxLabel = context === 'SS' ? 'Self-Service / portal download' : 'Formal Request (staff-fulfilled)';
  return ''
    + 'You extract a structured fee configuration from a U.S. public-records (FOIA / open-records) '
    + 'fee policy or ordinance. Read the POLICY TEXT and produce the agency fee config for the '
    + ctxLabel + ' context.\n\n'
    + 'Return ONLY a JSON object (no prose, no markdown fences) with keys: config, provenance, notes.\n\n'
    + 'config: use these EXACT keys. For each rate put a NUMBER if a dollar amount is stated, the '
    + 'string "actual" if the policy says actual/reasonable cost or a pass-through, or null if the '
    + 'text does NOT specify it. Never guess a number.\n'
    + '{\n'
    + '  "context": "' + (context === 'SS' ? 'SS' : 'FR') + '",\n'
    + '  "labor": {"search": {"rate": null, "increment": 0, "rounding": "up"}, "review": {"rate": null, "increment": 0, "rounding": "up"}, "programming": {"rate": null, "increment": 0, "rounding": "up"}},\n'
    + '  "duplication": {"bw": {"rate": null}, "color": {"rate": null}, "oversized": {"rate": null}, "specialty": {"rate": null}},\n'
    + '  "media": {"cd": null, "dvd": null, "usb": null},\n'
    + '  "av": {"perRecording": null, "perMinute": null, "freeMinutes": null},\n'
    + '  "delivery": {"email": null, "pickup": null, "mail": null, "handling": null},\n'
    + '  "certification": {"rate": null, "unit": "per_record"},\n'
    + '  "requestRules": {"freePageAllowance": null, "freeLaborHours": null, "deMinimis": null, "minFee": null, "maxFee": null, "deposit": {"threshold": null, "percent": null}, "estimateNotifyThreshold": null},\n'
    + '  "estimatePolicy": {"requesterResponseDays": null, "revisionNotifyPercent": null, "estimateValidityDays": null}\n'
    + '}\n'
    + 'Units: labor rate is $/hour; duplication is $/page; media is $/item; handling is $ flat. av.perRecording is $ per audio/video recording and av.perMinute is $ per minute of recording (e.g. police body-cam); av.freeMinutes is a minute count. '
    + 'labor.increment is one of 0 (bill actual time), 0.25, 0.5, 1 (hours). rounding is "up", "down", or "nearest". '
    + 'deposit.percent is a number like 50 for 50%. requestRules thresholds are dollar amounts. '
    + 'freePageAllowance is a page count; freeLaborHours is hours. estimatePolicy.requesterResponseDays = business days the requester has to accept an estimate before it lapses; revisionNotifyPercent = re-notify the requester if the cost changes by more than this percent; estimateValidityDays = days an estimate stays valid.\n\n'
    + 'provenance: an array of objects { "field": dot-path (e.g. "labor.search.rate"), "value": the value you set, '
    + '"confidence": a number 0..1, "citation": a SHORT quote or section reference from the text, 15 words or fewer }. '
    + 'Include one entry for EVERY non-null value you set.\n\n'
    + 'notes: a short string noting what the text did not specify or anything ambiguous.\n\n'
    + 'POLICY TEXT:\n' + text;
}

async function extract(text, opts) {
  opts = opts || {};
  var context = opts.context === 'SS' ? 'SS' : 'FR';
  var clean = String(text || '').slice(0, 16000);
  if (!clean.trim()) throw new Error('No policy text provided.');
  var client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  var message = await client.messages.create({ model: 'claude-sonnet-4-5', max_tokens: 2500, messages: [{ role: 'user', content: buildPrompt(clean, context) }] });
  var raw = (message.content[0] && message.content[0].text ? message.content[0].text : '').trim().replace(/```json|```/g, '').trim();
  var parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') throw new Error('Unexpected extraction result.');
  parsed.config = parsed.config || {};
  parsed.provenance = Array.isArray(parsed.provenance) ? parsed.provenance : [];
  parsed.notes = parsed.notes || '';
  return parsed;
}

module.exports = { extract: extract };

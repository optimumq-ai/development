'use strict';
// THE ONE DOOR TO THE MODEL (2026-09-16). Every place the application calls Claude goes through clientFor(caller),
// which returns an object with the same `messages.create(params)` shape the Anthropic SDK client has — so call sites
// are unchanged — and LOGS every call to `ai_calls`: caller, model, the usage the API reports (fresh input, cache write,
// cache read, output), duration, and failures. Never the prompt, never the answer.
//
// Why: Kevin's platform usage report showed millions of Sonnet tokens with no way to say which feature spent them.
// With this table the report is explainable from inside the app (AI configuration › AI Usage), and the classifier's
// prompt cache (see classifier.js) can be VERIFIED — `cache_read_input_tokens` is the proof it works.
//
// Prompt caching helper: cachedSystem(text) marks a stable system block as an ephemeral cache breakpoint (5-minute
// TTL by default — the right choice for bursts such as the test suites and intake spikes; a 1-hour TTL doubles the
// write price and only pays when requests sharing the prefix arrive 5–60 minutes apart). Sonnet 5 caches prefixes of
// 1,024 tokens or more; shorter blocks are silently not cached, so only mark blocks that are genuinely large.
var { all, get, run } = require('../db');
var { v4: uuidv4 } = require('uuid');

var transport = null;           // test seam: function(params) -> message
var CACHE_TTL = null;           // null = 5-minute default; '1h' = one-hour entries (2× write price)

function now() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }

function sdkClient() {
  var Anthropic = require('@anthropic-ai/sdk');
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

async function log(row) {
  try {
    await run('INSERT INTO ai_calls (id, at, caller, model, input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens, duration_ms, ok, error, message_id, context) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      ['aic-' + uuidv4().substring(0, 12), now(), row.caller, row.model || null, row.input_tokens || 0, row.cache_creation_input_tokens || 0, row.cache_read_input_tokens || 0, row.output_tokens || 0, (row.duration_ms != null ? row.duration_ms : null), row.ok ? 1 : 0, row.error ? String(row.error).slice(0, 300) : null, row.message_id || null, row.context || null]);
  } catch (e) { console.error('[aiClient] could not log call:', e && e.message); }
}

// Returns a client-shaped object: { messages: { create(params) } }. `context` is an optional short tag.
function clientFor(caller, context) {
  return {
    messages: {
      create: async function (params) {
        var t0 = Date.now();
        try {
          var message = transport ? await transport(params) : await sdkClient().messages.create(params);
          var u = (message && message.usage) || {};
          await log({ caller: caller, model: params && params.model, input_tokens: u.input_tokens, cache_creation_input_tokens: u.cache_creation_input_tokens, cache_read_input_tokens: u.cache_read_input_tokens, output_tokens: u.output_tokens, duration_ms: Date.now() - t0, ok: true, message_id: message && message.id, context: context || null });
          return message;
        } catch (e) {
          await log({ caller: caller, model: params && params.model, duration_ms: Date.now() - t0, ok: false, error: (e && e.message) || String(e), context: context || null });
          throw e;
        }
      }
    }
  };
}

// A system prompt as cacheable blocks: stable text first, marked as the cache breakpoint; anything that varies per
// request belongs in the user message, after the breakpoint.
function cachedSystem(stableText) {
  var block = { type: 'text', text: stableText, cache_control: CACHE_TTL ? { type: 'ephemeral', ttl: CACHE_TTL } : { type: 'ephemeral' } };
  return [block];
}

// Aggregates for the AI Usage tab: by caller and by day, over the last N days.
async function summary(days) {
  days = Math.max(1, Math.min(365, Number(days) || 30));
  var since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  var byCaller = await all("SELECT caller, model, count(*)::int AS calls, sum(input_tokens)::bigint AS input_tokens, sum(cache_creation_input_tokens)::bigint AS cache_write, sum(cache_read_input_tokens)::bigint AS cache_read, sum(output_tokens)::bigint AS output_tokens, sum(CASE WHEN ok = 0 THEN 1 ELSE 0 END)::int AS errors, round(avg(duration_ms))::int AS avg_ms, max(at) AS last_at FROM ai_calls WHERE at >= ? GROUP BY caller, model ORDER BY (sum(input_tokens) + sum(cache_creation_input_tokens) + sum(cache_read_input_tokens) + sum(output_tokens)) DESC", [since]);
  var byDay = await all("SELECT substr(at, 1, 10) AS day, model, count(*)::int AS calls, sum(input_tokens)::bigint AS input_tokens, sum(cache_creation_input_tokens)::bigint AS cache_write, sum(cache_read_input_tokens)::bigint AS cache_read, sum(output_tokens)::bigint AS output_tokens FROM ai_calls WHERE at >= ? GROUP BY substr(at, 1, 10), model ORDER BY day DESC, model", [since]);
  function nums(r) { ['input_tokens', 'cache_write', 'cache_read', 'output_tokens'].forEach(function (k) { r[k] = Number(r[k] || 0); }); return r; }
  byCaller.forEach(nums); byDay.forEach(nums);
  var totals = byCaller.reduce(function (t, r) { t.calls += r.calls; t.input_tokens += r.input_tokens; t.cache_write += r.cache_write; t.cache_read += r.cache_read; t.output_tokens += r.output_tokens; t.errors += r.errors; return t; }, { calls: 0, input_tokens: 0, cache_write: 0, cache_read: 0, output_tokens: 0, errors: 0 });
  var cacheable = totals.input_tokens + totals.cache_write + totals.cache_read;
  totals.cache_hit_share = cacheable ? Math.round(totals.cache_read / cacheable * 100) : 0;
  return { days: days, since: since, totals: totals, by_caller: byCaller, by_day: byDay };
}

module.exports = { clientFor: clientFor, cachedSystem: cachedSystem, summary: summary, _setTransport: function (fn) { transport = fn; }, _setCacheTtl: function (ttl) { CACHE_TTL = ttl || null; } };

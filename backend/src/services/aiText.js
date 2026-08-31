'use strict';
// The text of a model response. Sonnet 5 runs ADAPTIVE THINKING by default, so `content[0]` may be a
// `thinking` block — `message.content[0].text` then reads undefined/'' and a JSON.parse downstream dies with
// "Unexpected end of JSON input" (first seen live: request 2026-000006, CLASSIFICATION_UNAVAILABLE,
// 2026-08-31). Join every text block; never index content[0] for text anywhere that calls the model.
function textOf(message) {
  if (!message || !Array.isArray(message.content)) return '';
  return message.content.map(function (b) { return b && b.type === 'text' && b.text ? b.text : ''; }).join('').trim();
}
module.exports = { textOf: textOf };

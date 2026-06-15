// Reusable, email-client-safe HTML template for outbound mail. Uses table layout + inline styles so
// Outlook and other clients render it correctly (they ignore white-space:pre-wrap and external CSS).
// textToHtml() turns a plain-text body - paragraphs, "- " bullet lines, and an "Estimated cost:"
// line - into real HTML; wrap() applies the branded shell. Reusable for any outbound email.
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function textToHtml(text) {
  var lines = String(text || '').split('\n');
  var out = '', para = [], inList = false;
  function flushPara() { if (para.length) { out += '<p style="margin:0 0 12px;">' + para.join('<br>') + '</p>'; para = []; } }
  function closeList() { if (inList) { out += '</ul>'; inList = false; } }
  for (var i = 0; i < lines.length; i++) {
    var raw = lines[i], t = raw.trim();
    if (t.indexOf('- ') === 0) { flushPara(); if (!inList) { out += '<ul style="margin:0 0 12px;padding-left:20px;">'; inList = true; } out += '<li style="margin:0 0 5px;">' + esc(t.slice(2)) + '</li>'; }
    else if (t === '') { flushPara(); closeList(); }
    else if (/^Estimated cost:/i.test(t)) { flushPara(); closeList(); out += '<div style="background:#EFF6FF;border:1px solid #DBEAFE;border-radius:8px;padding:12px 16px;margin:0 0 14px;font-size:18px;font-weight:700;color:#1F4E79;">' + esc(t) + '</div>'; }
    else { closeList(); para.push(esc(raw)); }
  }
  flushPara(); closeList();
  return out;
}

function wrap(opts) {
  opts = opts || {};
  var header = esc(opts.agencyName || 'Open Records');
  var sub = esc(opts.headerSub || 'Office of Open Records / Public Information');
  var footer = esc(opts.footerNote || 'This message was sent by the Open Records office. Please reply with any questions about your request.');
  return '<!doctype html><html><body style="margin:0;padding:0;background:#F3F4F6;">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;"><tr><td align="center" style="padding:24px 12px;">'
    + '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #E5E7EB;font-family:Arial,Helvetica,sans-serif;">'
    + '<tr><td style="background:#1F4E79;padding:18px 28px;"><div style="color:#ffffff;font-size:18px;font-weight:700;">' + header + '</div><div style="color:#cfe0f0;font-size:12px;margin-top:2px;">' + sub + '</div></td></tr>'
    + '<tr><td style="padding:24px 28px;color:#111111;font-size:14px;line-height:1.6;">' + (opts.contentHtml || '') + '</td></tr>'
    + '<tr><td style="background:#F9FAFB;border-top:1px solid #E5E7EB;padding:14px 28px;color:#9CA3AF;font-size:11px;line-height:1.5;">' + footer + '</td></tr>'
    + '</table></td></tr></table></body></html>';
}

module.exports = { wrap: wrap, textToHtml: textToHtml, esc: esc };

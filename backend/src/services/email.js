const nodemailer = require('nodemailer');
const { Resend } = require('resend');
const { get } = require('../db');

async function cfg(key) {
  var row = await get('SELECT value FROM system_config WHERE key = ?', [key]);
  return row ? row.value : '';
}

async function getTransport() {
  var host = await cfg('smtp_host');
  var port = parseInt(await cfg('smtp_port') || '587', 10);
  var user = await cfg('smtp_user');
  var pass = await cfg('smtp_pass');
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({
    host: host,
    port: port,
    secure: port === 465,
    auth: { user: user, pass: pass },
    family: 4,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000
  });
}

async function send(opts) {
  var resendKey = await cfg('resend_api_key');
  var fromName = await cfg('agency_name') || 'Public Records';

  // Prefer Resend if API key is configured
  if (resendKey) {
    var resendFrom = await cfg('resend_from') || 'onboarding@resend.dev';
    try {
      var resend = new Resend(resendKey);
      var result = await resend.emails.send({
        from: fromName + ' <' + resendFrom + '>',
        to: opts.to,
        subject: opts.subject,
        text: opts.text,
        html: opts.html
      });
      if (result.error) {
        console.error('[email] Resend send failed:', JSON.stringify(result.error));
        return { sent: false, reason: 'error', error: result.error.message || JSON.stringify(result.error) };
      }
      console.log('[email] sent via Resend, id=' + (result.data && result.data.id) + ' to', opts.to);
      return { sent: true, messageId: result.data && result.data.id, provider: 'resend' };
    } catch(e) {
      console.error('[email] Resend send error:', e.message);
      return { sent: false, reason: 'error', error: e.message };
    }
  }

  // Fall back to SMTP
  var transport = await getTransport();
  if (!transport) {
    console.log('[email] No email provider configured (no Resend key, no SMTP), skipping send to', opts.to);
    return { sent: false, reason: 'not_configured' };
  }
  var from = await cfg('smtp_from') || await cfg('smtp_user');
  try {
    var info = await transport.sendMail({
      from: '"' + fromName + '" <' + from + '>',
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html
    });
    console.log('[email] sent via SMTP', info.messageId, 'to', opts.to);
    return { sent: true, messageId: info.messageId, provider: 'smtp' };
  } catch(e) {
    console.error('[email] SMTP send failed:', e.message);
    return { sent: false, reason: 'error', error: e.message };
  }
}

function template(body, agencyName) {
  return '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111">' +
    '<div style="background:#1F4E79;color:white;padding:18px 22px;border-radius:10px 10px 0 0;font-size:18px;font-weight:700">' + agencyName + '</div>' +
    '<div style="background:#F9FAFB;padding:24px 22px;border-radius:0 0 10px 10px;border:1px solid #E5E7EB;border-top:none">' + body + '</div>' +
    '<div style="text-align:center;font-size:11px;color:#9CA3AF;margin-top:12px">This is an automated message. Please do not reply directly.</div>' +
  '</div>';
}

async function sendSubmissionConfirmation(req) {
  var agencyName = await cfg('agency_name') || 'Public Records';
  var contactEmail = await cfg('contact_email') || '';
  var contactPhone = await cfg('contact_phone') || '';
  var body = '<h2 style="margin:0 0 10px;color:#1F4E79;font-size:18px">Your records request has been received</h2>' +
    '<p style="font-size:14px;line-height:1.5;color:#374151">Thank you for your request. We have received it and will begin processing.</p>' +
    '<div style="background:white;border:1px solid #E5E7EB;border-radius:8px;padding:14px;margin:16px 0">' +
      '<div style="font-size:11px;text-transform:uppercase;color:#6B7280;letter-spacing:0.5px;margin-bottom:4px">Request Number</div>' +
      '<div style="font-size:24px;font-weight:700;color:#1F4E79;font-family:monospace">' + req.request_number + '</div>' +
    '</div>' +
    '<p style="font-size:13px;color:#374151;margin:14px 0 6px"><strong>What you requested:</strong></p>' +
    '<p style="font-size:13px;color:#374151;background:white;padding:10px;border-radius:6px;border:1px solid #E5E7EB;white-space:pre-wrap">' + (req.description || '').replace(/</g,'&lt;') + '</p>' +
    '<p style="font-size:13px;color:#374151;margin-top:16px"><strong>What happens next:</strong></p>' +
    '<ul style="font-size:13px;color:#374151;line-height:1.6;padding-left:20px">' +
      '<li>Our staff will review your request and route it to the right department.</li>' +
      '<li>If we need clarification, we will contact you using the information you provided.</li>' +
      '<li>If fees apply, we will send an estimate before any work begins.</li>' +
      '<li>You will be notified when your records are ready.</li>' +
    '</ul>' +
    '<p style="font-size:12px;color:#6B7280;margin-top:18px">Save your request number — you will use it for any follow-up communication.</p>' +
    (contactEmail || contactPhone ? '<p style="font-size:12px;color:#6B7280">Questions? Contact us at ' + (contactEmail ? contactEmail : '') + (contactEmail && contactPhone ? ' or ' : '') + (contactPhone ? contactPhone : '') + '.</p>' : '');
  return send({
    to: req.requestor_email,
    subject: 'Records Request Received: ' + req.request_number,
    text: 'Your records request ' + req.request_number + ' has been received. We will process it and contact you with updates.',
    html: template(body, agencyName)
  });
}

async function sendNewRequestAlert(req) {
  var agencyName = await cfg('agency_name') || 'Public Records';
  var alertTo = await cfg('new_request_alert_email') || await cfg('contact_email');
  if (!alertTo) return { sent: false, reason: 'no_alert_recipient' };
  var body = '<h2 style="margin:0 0 10px;color:#1F4E79;font-size:18px">New Records Request</h2>' +
    '<div style="background:white;border:1px solid #E5E7EB;border-radius:8px;padding:14px;margin:12px 0">' +
      '<table style="width:100%;font-size:13px;color:#374151"><tbody>' +
        '<tr><td style="padding:4px 0;color:#6B7280;width:130px">Request Number</td><td style="font-weight:600;font-family:monospace">' + req.request_number + '</td></tr>' +
        '<tr><td style="padding:4px 0;color:#6B7280">Requestor</td><td>' + (req.requestor_name || '') + '</td></tr>' +
        '<tr><td style="padding:4px 0;color:#6B7280">Email</td><td>' + (req.requestor_email || '') + '</td></tr>' +
        '<tr><td style="padding:4px 0;color:#6B7280">Channel</td><td>' + (req.submission_channel || '') + '</td></tr>' +
        '<tr><td style="padding:4px 0;color:#6B7280">Classification</td><td>' + (req.classification || '') + '</td></tr>' +
        '<tr><td style="padding:4px 0;color:#6B7280">Deadline</td><td>' + (req.deadline_date || '') + '</td></tr>' +
      '</tbody></table>' +
    '</div>' +
    '<p style="font-size:13px;color:#374151"><strong>Description:</strong></p>' +
    '<p style="font-size:13px;color:#374151;background:white;padding:10px;border-radius:6px;border:1px solid #E5E7EB;white-space:pre-wrap">' + (req.description || '').replace(/</g,'&lt;') + '</p>';
  return send({
    to: alertTo,
    subject: '[New Request] ' + req.request_number + ' - ' + (req.requestor_name || 'Unknown'),
    text: 'New records request ' + req.request_number + ' from ' + req.requestor_name + ' (' + req.requestor_email + ')',
    html: template(body, agencyName)
  });
}

async function sendFeeWaiverDenial(req, reasonText) {
  var agencyName = await cfg('agency_name') || 'Public Records';
  var contactEmail = await cfg('contact_email') || '';
  var contactPhone = await cfg('contact_phone') || '';
  var body = '<h2 style="margin:0 0 10px;color:#1F4E79;font-size:18px">Decision on your fee-waiver request</h2>' +
    '<p style="font-size:14px;line-height:1.5;color:#374151">After review, your request to waive the fees associated with the following records request has been <strong>denied</strong>.</p>' +
    '<div style="background:white;border:1px solid #E5E7EB;border-radius:8px;padding:14px;margin:16px 0">' +
      '<div style="font-size:11px;text-transform:uppercase;color:#6B7280;letter-spacing:0.5px;margin-bottom:4px">Request Number</div>' +
      '<div style="font-size:22px;font-weight:700;color:#1F4E79;font-family:monospace">' + req.request_number + '</div>' +
    '</div>' +
    '<p style="font-size:13px;color:#374151;margin:14px 0 6px"><strong>Reason for denial:</strong></p>' +
    '<div style="background:white;border:1px solid #E5E7EB;border-left:4px solid #D97706;border-radius:8px;padding:14px;font-size:14px;color:#374151">' + (reasonText || '').replace(/</g,'&lt;') + '</div>' +
    '<p style="font-size:13px;color:#374151;margin-top:16px">Your records request <strong>remains open</strong> and will continue to be processed. If fees apply, we will send you an estimate before any work begins, and you may decide how to proceed at that time.</p>' +
    (contactEmail || contactPhone ? '<p style="font-size:12px;color:#6B7280;margin-top:16px">Questions about this decision? Contact us at ' + (contactEmail || '') + (contactEmail && contactPhone ? ' or ' : '') + (contactPhone || '') + '.</p>' : '');
  return send({
    to: req.requestor_email,
    subject: 'Fee-Waiver Decision: ' + req.request_number,
    text: 'Your fee-waiver request for ' + req.request_number + ' has been denied. Reason: ' + (reasonText || '') + '. Your records request remains open and will continue to be processed.',
    html: template(body, agencyName)
  });
}

module.exports = { send: send, sendSubmissionConfirmation: sendSubmissionConfirmation, sendNewRequestAlert: sendNewRequestAlert, sendFeeWaiverDenial: sendFeeWaiverDenial };

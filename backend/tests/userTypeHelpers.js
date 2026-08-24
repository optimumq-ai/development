'use strict';
// Harness helpers for the v3 user-type model. Harnesses used to INSERT legacy function/permission roles for
// the throwaway users they create; legacy claims are now DERIVED from user types (SPEC_user_type_model §9.1),
// so a harness that wants a "supervisor" grants oro_supervisor / team_supervisor here instead.
//
//   grant(userId, 'oro_supervisor')                      office type
//   grant(userId, 'team_staff', 'team-police')           team type (teamId required)
//   grantLegacy(userId, 'fr-supervisor', teamId)         legacy id -> nearest user type (for mechanical conversions)
//   revokeAll([ids])                                     cleanup
const ut = require('/opt/optimumq/backend/src/services/userTypes');
const db = require('/opt/optimumq/backend/src/db');

// Nearest v3 type for a legacy role/permission id. Team types need the user's team; falls back to their
// users.department_id when none is passed.
const LEGACY_TO_TYPE = {
  'fr-sysadmin': 'oro_sysadmin', 'fr-director': 'oro_director', 'fr-supervisor': 'oro_supervisor',
  'fr-attorney': 'oro_senior_legal', 'fr-coordinator': 'oro_associate', 'fr-deptmanager': 'team_manager',
  'fr-custodian': 'team_staff', 'fr-redactionreviewer': 'oro_legal_associate', 'fr-redactionapprover': 'oro_senior_legal',
  'pr-reqmgr': 'oro_associate', 'pr-searchtriage': 'team_staff', 'pr-redworker': 'team_staff', 'pr-redauth': 'oro_senior_legal',
  'pr-feemgr': 'team_staff', 'pr-finance': 'oro_finance', 'pr-clarify': 'oro_associate', 'pr-delivery': 'oro_supervisor',
  'pr-denial': 'oro_legal_associate', 'pr-escalation': 'oro_supervisor', 'pr-reopen': 'oro_supervisor',
};

async function grant(userId, key, teamId) {
  if (ut.scopeOf(key) === 'team' && !teamId) {
    var u = await db.get('SELECT department_id FROM users WHERE id = ?', [userId]);
    teamId = u && u.department_id;
  }
  return ut.grant(userId, key, teamId || null, 'harness');
}
async function grantLegacy(userId, legacyId, teamId) {
  var key = LEGACY_TO_TYPE[legacyId];
  if (!key) throw new Error('no user type mapped for legacy id ' + legacyId);
  return grant(userId, key, teamId);
}
async function revokeAll(ids) {
  ids = Array.isArray(ids) ? ids : [ids];
  for (var i = 0; i < ids.length; i++) if (ids[i]) await ut.revokeAll(ids[i]);
}

module.exports = { grant, grantLegacy, revokeAll, LEGACY_TO_TYPE };

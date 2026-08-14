'use strict';
// Library destination ("shelf") resolution for released records that have no parent request.
// The public library browses on fulfilled_records.record_type_id + department_id; a record released
// outside a request (ad-hoc mass batch, import) has no request to inherit them from, so the shelf
// is decided at the point of work — the mass job / template apply — and stamped through to the
// fulfilled index. Request values always win over a destination: the request is the source of truth
// when one exists.
const { get } = require('../db');

// Owner department for a record type, walking up to the parent bucket when the variant has none —
// the same owner walk the classifier uses for routing.
async function ownerDepartment(recordTypeId) {
  if (!recordTypeId) return null;
  var r = await get(
    "SELECT COALESCE((SELECT department_id FROM record_type_departments WHERE record_type_id = rt.id AND role = 'owner' ORDER BY sort_order LIMIT 1), " +
    "(SELECT department_id FROM record_type_departments WHERE record_type_id = rt.parent_record_type_id AND role = 'owner' ORDER BY sort_order LIMIT 1)) AS dept " +
    "FROM record_types rt WHERE rt.id = ?", [recordTypeId]);
  return (r && r.dept) || null;
}

// explicit: { record_type_id, department_id } from the caller (job row / request body), either may
// be missing. templateRecordTypeId: the template's linked type, the default when nothing explicit.
// Returns { record_type_id, department_id } with department defaulted from the type's owner routing.
async function resolveDestination(explicit, templateRecordTypeId) {
  var rtId = (explicit && explicit.record_type_id) || templateRecordTypeId || null;
  var deptId = (explicit && explicit.department_id) || null;
  if (!deptId && rtId) deptId = await ownerDepartment(rtId);
  return { record_type_id: rtId, department_id: deptId };
}

module.exports = { ownerDepartment: ownerDepartment, resolveDestination: resolveDestination };

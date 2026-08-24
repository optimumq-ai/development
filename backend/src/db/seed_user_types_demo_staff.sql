-- v3 user types for the DEMO staff accounts (seed_test_staff.sql + seed_testers.sql) — SPEC_user_type_model §3.
-- These are the fixture accounts the suite drives; they are not real people, so typing them here is fixture
-- maintenance, not the data migration §9 rules out. Real accounts get their types by hand (Staff Management, S3).
-- Idempotent: ON CONFLICT DO NOTHING against uq_user_user_types.
INSERT INTO user_user_types (user_id, user_type_id, team_id, assigned_by)
SELECT v.user_id, 'ut-' || v.type_key, v.team_id, 'seed'
FROM (VALUES
  -- testers: both office admin types (the demo admin keeps its reach, §4)
  ('u-kruss',         'oro_sysadmin',    NULL),
  ('u-kruss',         'oro_director',    NULL),
  ('u-sruss',         'oro_sysadmin',    NULL),
  ('u-sruss',         'oro_director',    NULL),
  -- fulfillment team supervisors / managers (legacy fr-supervisor / fr-deptmanager)
  ('u-police-super',  'team_supervisor', 'team-police'),
  ('u-clerk-super',   'team_supervisor', 'team-clerk-archives'),
  ('u-hr-super',      'team_supervisor', 'team-hr'),
  ('u-fire-super',    'team_supervisor', 'team-fire'),
  ('u-finance-super', 'team_manager',    'team-finance'),
  ('u-it-super',      'team_manager',    'team-it'),
  -- Robert Cho also carries the FINANCE capability (fee-waiver / objection approvals) as ORO Finance
  ('u-finance-super', 'oro_finance',     NULL),
  -- David Okafor, Assistant City Attorney: the legal reviewer
  ('u-legal-super',   'oro_senior_legal', NULL),
  -- fulfillment staff (legacy fr-custodian + search/redaction/fee perms)
  ('u-police-staff',  'team_staff',      'team-police'),
  ('u-finance-staff', 'team_staff',      'team-finance'),
  ('u-legal-staff',   'team_staff',      'team-legal'),
  ('u-it-staff',      'team_staff',      'team-it'),
  ('u-clerk-staff',   'team_staff',      'team-clerk-archives'),
  ('u-hr-staff',      'team_staff',      'team-hr'),
  ('u-fire-staff',    'team_staff',      'team-fire')
) AS v(user_id, type_key, team_id)
JOIN users u ON u.id = v.user_id
ON CONFLICT DO NOTHING;
UPDATE users SET auth_version = COALESCE(auth_version, 1) + 1 WHERE id IN (SELECT user_id FROM user_user_types WHERE assigned_by = 'seed');

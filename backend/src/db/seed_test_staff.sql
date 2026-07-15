-- TEST STAFF for fulfillment teams. All share temp password 'OptimumQ2026!' (temp_password=1; change on first login).
-- Admin (Kevin Hargrove) and Tom Jones (Open Records) are intentionally left untouched.
-- password_hash = sha256('OptimumQ2026!' + 'optimumq_salt_2024')

-- 1) Users (idempotent on id)
INSERT INTO users (id, email, display_name, title, department_id, password_hash, temp_password, status, created_at) VALUES
 ('u-police-staff', 'mbell@cityemail.gov',     'Marcus Bell',    'Records Technician',           'team-police',         'c90b41ee06000802c274447c52a0c29fec28805b065c9477313ee201962b06e3', 1, 'active', now()::text),
 ('u-police-super', 'dfoster@cityemail.gov',   'Diane Foster',   'Police Records Supervisor',    'team-police',         'c90b41ee06000802c274447c52a0c29fec28805b065c9477313ee201962b06e3', 1, 'active', now()::text),
 ('u-finance-staff','pnair@cityemail.gov',     'Priya Nair',     'Records Specialist',           'team-finance',        'c90b41ee06000802c274447c52a0c29fec28805b065c9477313ee201962b06e3', 1, 'active', now()::text),
 ('u-finance-super','rcho@cityemail.gov',      'Robert Cho',     'Finance Records Manager',      'team-finance',        'c90b41ee06000802c274447c52a0c29fec28805b065c9477313ee201962b06e3', 1, 'active', now()::text),
 ('u-legal-staff',  'hreyes@cityemail.gov',    'Hannah Reyes',   'Legal Records Clerk',          'team-legal',          'c90b41ee06000802c274447c52a0c29fec28805b065c9477313ee201962b06e3', 1, 'active', now()::text),
 ('u-legal-super',  'dokafor@cityemail.gov',   'David Okafor',   'Assistant City Attorney',      'team-legal',          'c90b41ee06000802c274447c52a0c29fec28805b065c9477313ee201962b06e3', 1, 'active', now()::text),
 ('u-it-staff',     'slin@cityemail.gov',      'Sara Lin',       'Records & Data Technician',    'team-it',             'c90b41ee06000802c274447c52a0c29fec28805b065c9477313ee201962b06e3', 1, 'active', now()::text),
 ('u-it-super',     'jpatel@cityemail.gov',    'James Patel',    'IT Records Manager',           'team-it',             'c90b41ee06000802c274447c52a0c29fec28805b065c9477313ee201962b06e3', 1, 'active', now()::text),
 ('u-clerk-staff',  'ebrooks@cityemail.gov',   'Evelyn Brooks',  'Archives Technician',          'team-clerk-archives', 'c90b41ee06000802c274447c52a0c29fec28805b065c9477313ee201962b06e3', 1, 'active', now()::text),
 ('u-clerk-super',  'gwhitfield@cityemail.gov','Grace Whitfield','Records & Archives Supervisor','team-clerk-archives', 'c90b41ee06000802c274447c52a0c29fec28805b065c9477313ee201962b06e3', 1, 'active', now()::text),
 ('u-hr-staff',     'nalvarez@cityemail.gov',  'Nina Alvarez',   'HR Records Clerk',             'team-hr',             'c90b41ee06000802c274447c52a0c29fec28805b065c9477313ee201962b06e3', 1, 'active', now()::text),
 ('u-hr-super',     'btate@cityemail.gov',     'Brian Tate',     'HR Records Supervisor',        'team-hr',             'c90b41ee06000802c274447c52a0c29fec28805b065c9477313ee201962b06e3', 1, 'active', now()::text),
 ('u-fire-staff',   'cmendez@cityemail.gov',   'Carlos Mendez',  'Fire Records Technician',      'team-fire',           'c90b41ee06000802c274447c52a0c29fec28805b065c9477313ee201962b06e3', 1, 'active', now()::text),
 ('u-fire-super',   'lkim@cityemail.gov',      'Laura Kim',      'Fire Records Supervisor',      'team-fire',           'c90b41ee06000802c274447c52a0c29fec28805b065c9477313ee201962b06e3', 1, 'active', now()::text)
ON CONFLICT (id) DO UPDATE SET email=EXCLUDED.email, display_name=EXCLUDED.display_name, title=EXCLUDED.title, department_id=EXCLUDED.department_id, password_hash=EXCLUDED.password_hash, temp_password=1, status='active';

-- 2) Clear any prior role mappings for these test ids, then reassign
DELETE FROM user_function_roles WHERE user_id LIKE 'u-police-%' OR user_id LIKE 'u-finance-%' OR user_id LIKE 'u-legal-%' OR user_id LIKE 'u-it-%' OR user_id LIKE 'u-clerk-%' OR user_id LIKE 'u-hr-%' OR user_id LIKE 'u-fire-%';
DELETE FROM user_permission_roles WHERE user_id LIKE 'u-police-%' OR user_id LIKE 'u-finance-%' OR user_id LIKE 'u-legal-%' OR user_id LIKE 'u-it-%' OR user_id LIKE 'u-clerk-%' OR user_id LIKE 'u-hr-%' OR user_id LIKE 'u-fire-%';

-- 3) Function (job) roles
INSERT INTO user_function_roles (user_id, function_role_id) VALUES
 ('u-police-staff','fr-custodian'),('u-finance-staff','fr-custodian'),('u-legal-staff','fr-custodian'),
 ('u-it-staff','fr-custodian'),('u-clerk-staff','fr-custodian'),('u-hr-staff','fr-custodian'),('u-fire-staff','fr-custodian'),
 ('u-police-super','fr-supervisor'),('u-clerk-super','fr-supervisor'),('u-hr-super','fr-supervisor'),('u-fire-super','fr-supervisor'),
 ('u-finance-super','fr-deptmanager'),('u-it-super','fr-deptmanager'),
 ('u-legal-super','fr-attorney');

-- 4) Permission (capability) roles
-- 4a) Staffers: doer capabilities
INSERT INTO user_permission_roles (user_id, permission_role_id)
SELECT u.id, p.id
FROM (VALUES ('u-police-staff'),('u-finance-staff'),('u-legal-staff'),('u-it-staff'),('u-clerk-staff'),('u-hr-staff'),('u-fire-staff')) AS u(id)
CROSS JOIN (VALUES ('pr-searchtriage'),('pr-reqmgr'),('pr-clarify'),('pr-delivery'),('pr-redworker')) AS p(id);
-- 4b) Supervisors: doer + authority capabilities
INSERT INTO user_permission_roles (user_id, permission_role_id)
SELECT u.id, p.id
FROM (VALUES ('u-police-super'),('u-finance-super'),('u-legal-super'),('u-it-super'),('u-clerk-super'),('u-hr-super'),('u-fire-super')) AS u(id)
CROSS JOIN (VALUES ('pr-searchtriage'),('pr-reqmgr'),('pr-clarify'),('pr-delivery'),('pr-redworker'),('pr-feemgr'),('pr-finance'),('pr-escalation'),('pr-redauth'),('pr-reopen')) AS p(id);
-- 4c) Legal supervisor: denial/legal authority
INSERT INTO user_permission_roles (user_id, permission_role_id) VALUES ('u-legal-super','pr-denial');

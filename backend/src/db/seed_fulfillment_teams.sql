-- Department-specific fulfillment teams (kind='team'), parented to their department.
-- Open Records remains the central intake team; these handle their own department's records.
INSERT INTO departments (id, name, code, color, is_open_records, kind, parent_id, sort_order, active) VALUES
 ('team-police',         'Police Records Unit',          'PRU', '#7C3AED', 0, 'team', 'dept-police',   30, 1),
 ('team-finance',        'Finance Records Team',         'FRT', '#0E7490', 0, 'team', 'dept-finance',  31, 1),
 ('team-legal',          'Legal Records Team',           'LRT', '#B45309', 0, 'team', 'dept-attorney', 32, 1),
 ('team-it',             'IT Records Team',              'ITR', '#2563EB', 0, 'team', 'dept-it',       33, 1),
 ('team-clerk-archives', 'City Clerk Records & Archives','CRA', '#65A30D', 0, 'team', 'dept-clerk',    34, 1),
 ('team-hr',             'HR Records Team',              'HRT', '#DB2777', 0, 'team', 'dept-hr',       35, 1)
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, code=EXCLUDED.code, color=EXCLUDED.color, kind=EXCLUDED.kind, parent_id=EXCLUDED.parent_id, sort_order=EXCLUDED.sort_order, active=1;

-- Route each department to its fulfillment team; others remain with central Open Records.
UPDATE departments SET processed_by='team-police'         WHERE id='dept-police';
UPDATE departments SET processed_by='team-finance'        WHERE id='dept-finance';
UPDATE departments SET processed_by='team-legal'          WHERE id='dept-attorney';
UPDATE departments SET processed_by='team-it'             WHERE id='dept-it';
UPDATE departments SET processed_by='team-clerk-archives' WHERE id='dept-clerk';
UPDATE departments SET processed_by='team-hr'             WHERE id='dept-hr';

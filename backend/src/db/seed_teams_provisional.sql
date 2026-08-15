-- Open Records OFFICE vs Open Records FULFILLMENT TEAM (final model, Kevin 2026-08-15;
-- DESIGN_user_type_role_model.md §7 "critical distinction"):
--  * 'dept-openrecords' = the Open Records OFFICE — oversight/administration (director, legal
--    authority, associates). A team for STAFFING only: it serves no departments and never appears
--    in request routing. It manages MRRs, but MRR child work is hand-assigned, not team-routed.
--  * 'team-openrecords' = the Open Records FULFILLMENT TEAM — a real fulfillment team like any
--    department's, serving the small/low-volume departments that don't warrant their own team,
--    and carrying is_open_records=1 (the routing FALLBACK for anything unmatched).
-- Idempotent.
UPDATE departments SET kind='team', parent_id='dept-clerk', name='Open Records Office', is_open_records=0 WHERE id='dept-openrecords';
INSERT INTO departments (id, name, code, color, is_open_records, is_catch_all, kind, parent_id, sort_order, active)
VALUES ('team-openrecords','Open Records Fulfillment Team','ORF','#0F766E',1,0,'team','dept-clerk',29,1)
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, code=EXCLUDED.code, kind=EXCLUDED.kind, parent_id=EXCLUDED.parent_id, is_open_records=1, active=1;
-- Default: every department not claimed by its own team is fulfilled by the central team.
UPDATE departments SET processed_by='team-openrecords' WHERE active=1 AND COALESCE(kind,'department')='department' AND (processed_by IS NULL OR processed_by='dept-openrecords');

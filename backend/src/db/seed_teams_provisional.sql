-- PROVISIONAL (for review) - models the Departments vs Teams concept:
--  * Open Records becomes a fulfillment TEAM under the City Clerk department
--  * every department defaults to being processed by that team (central-intake model)
-- Revisit in iteration 2 once the Departments & Teams model is confirmed. Idempotent.
UPDATE departments SET kind='team', parent_id='dept-clerk' WHERE id='dept-openrecords';
UPDATE departments SET processed_by='dept-openrecords' WHERE active=1 AND id <> 'dept-openrecords';

-- Real testers: Kerri Russ and Steve Russ — ORO System Administrator + ORO Director (v3 user types, S5).
-- Placeholder login emails (kruss@/sruss@optimumq.ai) until real addresses are provided.
-- Temp password 'OptimumQ2026!' (temp_password=1, change on first login).
INSERT INTO users (id, email, display_name, title, department_id, password_hash, temp_password, status, created_at) VALUES
 ('u-kruss','kruss@optimumq.ai','Kerri Russ','Administrator','dept-openrecords','c90b41ee06000802c274447c52a0c29fec28805b065c9477313ee201962b06e3',1,'active',now()::text),
 ('u-sruss','sruss@optimumq.ai','Steve Russ','Administrator','dept-openrecords','c90b41ee06000802c274447c52a0c29fec28805b065c9477313ee201962b06e3',1,'active',now()::text)
ON CONFLICT (id) DO UPDATE SET email=EXCLUDED.email, display_name=EXCLUDED.display_name, title=EXCLUDED.title, department_id=EXCLUDED.department_id, password_hash=EXCLUDED.password_hash, temp_password=1, status='active';

INSERT INTO user_user_types (user_id, user_type_id, team_id, assigned_by) VALUES
 ('u-kruss','ut-oro_sysadmin',NULL,'seed'),('u-kruss','ut-oro_director',NULL,'seed'),
 ('u-sruss','ut-oro_sysadmin',NULL,'seed'),('u-sruss','ut-oro_director',NULL,'seed')
ON CONFLICT DO NOTHING;

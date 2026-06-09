-- Real testers: Kerri Russ and Steve Russ, full system admins.
-- Placeholder login emails (kruss@/sruss@optimumq.ai) until real addresses are provided.
-- Temp password 'OptimumQ2026!' (temp_password=1, change on first login).
INSERT INTO users (id, email, display_name, title, department_id, password_hash, temp_password, status, created_at) VALUES
 ('u-kruss','kruss@optimumq.ai','Kerri Russ','Administrator','dept-openrecords','c90b41ee06000802c274447c52a0c29fec28805b065c9477313ee201962b06e3',1,'active',now()::text),
 ('u-sruss','sruss@optimumq.ai','Steve Russ','Administrator','dept-openrecords','c90b41ee06000802c274447c52a0c29fec28805b065c9477313ee201962b06e3',1,'active',now()::text)
ON CONFLICT (id) DO UPDATE SET email=EXCLUDED.email, display_name=EXCLUDED.display_name, title=EXCLUDED.title, department_id=EXCLUDED.department_id, password_hash=EXCLUDED.password_hash, temp_password=1, status='active';

DELETE FROM user_function_roles WHERE user_id IN ('u-kruss','u-sruss');
DELETE FROM user_permission_roles WHERE user_id IN ('u-kruss','u-sruss');

INSERT INTO user_function_roles (user_id, function_role_id) VALUES ('u-kruss','fr-sysadmin'),('u-sruss','fr-sysadmin');

INSERT INTO user_permission_roles (user_id, permission_role_id)
SELECT u.id, p.id FROM (VALUES ('u-kruss'),('u-sruss')) AS u(id)
CROSS JOIN (VALUES ('pr-clarify'),('pr-delivery'),('pr-denial'),('pr-escalation'),('pr-feeauth'),('pr-feemgr'),('pr-redauth'),('pr-redworker'),('pr-reqmgr'),('pr-reopen'),('pr-searchtriage')) AS p(id);

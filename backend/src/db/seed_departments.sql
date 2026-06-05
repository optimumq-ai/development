-- Departments seed (Postgres). Idempotent via ON CONFLICT (id). Canonical for the Postgres era.
INSERT INTO departments (id, name, code, color, is_open_records, is_catch_all, sort_order, active) VALUES
('dept-openrecords','Open Records','OR','#1F4E79',1,0,0,1),
('dept-clerk','City Clerk','CC','#2E75B6',0,1,1,1),
('dept-building','Building & Planning','BP','#5B9BD5',0,0,2,1),
('dept-attorney','City Attorney','CA','#843C0C',0,0,3,1),
('dept-finance','Finance & Accounting','FA','#375623',0,0,4,1),
('dept-it','Information Technology','IT','#7030A0',0,0,5,1),
('dept-police','Police Department','PD','#1F3864',0,0,6,1),
('dept-publicworks','Public Works','PW','#7F6000',0,0,7,1),
('dept-fire','Fire Department','FD','#C0392B',0,0,8,1),
('dept-hr','Human Resources','HR','#27AE60',0,0,9,1),
('dept-pio','Public Information Office','PIO','#8E44AD',0,0,10,1)
ON CONFLICT (id) DO NOTHING;

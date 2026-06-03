-- Postgres schema ported from live SQLite. Parity-first: INTEGER booleans kept, money REAL->DOUBLE PRECISION, timestamps kept as TEXT in same format.
CREATE TABLE IF NOT EXISTS system_config (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')));
CREATE TABLE IF NOT EXISTS departments (id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT UNIQUE NOT NULL, color TEXT DEFAULT '#2E75B6', is_open_records INTEGER DEFAULT 0, is_catch_all INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 0, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, title TEXT, department_id TEXT, password_hash TEXT, mfa_secret TEXT, mfa_enrolled INTEGER DEFAULT 0, temp_password INTEGER DEFAULT 0, status TEXT DEFAULT 'active', last_login TEXT, created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')));
CREATE TABLE IF NOT EXISTS function_roles (id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, sort_order INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS permission_roles (id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS user_function_roles (user_id TEXT NOT NULL, function_role_id TEXT NOT NULL, PRIMARY KEY (user_id, function_role_id));
CREATE TABLE IF NOT EXISTS user_permission_roles (user_id TEXT NOT NULL, permission_role_id TEXT NOT NULL, PRIMARY KEY (user_id, permission_role_id));
CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, request_number TEXT UNIQUE NOT NULL, is_mrr INTEGER DEFAULT 0, master_request_id TEXT, component_label TEXT, requestor_name TEXT NOT NULL, requestor_email TEXT NOT NULL, requestor_phone TEXT, requestor_type TEXT DEFAULT 'individual', delivery_method TEXT DEFAULT 'email', description TEXT NOT NULL, record_types TEXT, classification TEXT DEFAULT 'standard', department_id TEXT, assigned_to TEXT, stage TEXT DEFAULT 'intake', status TEXT DEFAULT 'active', closure_reason TEXT,
 fee_waiver_requested INTEGER DEFAULT 0, estimated_fee DOUBLE PRECISION DEFAULT 0, actual_fee DOUBLE PRECISION DEFAULT 0, amount_paid DOUBLE PRECISION DEFAULT 0, legal_flag INTEGER DEFAULT 0, legal_flag_type TEXT, deadline_date TEXT, submission_channel TEXT DEFAULT 'portal', created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')), updated_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')));
CREATE TABLE IF NOT EXISTS request_history (id TEXT PRIMARY KEY, request_id TEXT NOT NULL, actor_id TEXT, actor_name TEXT NOT NULL, action TEXT NOT NULL, details TEXT, notes TEXT, stage_from TEXT, stage_to TEXT, created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')));
CREATE TABLE IF NOT EXISTS fee_matrix (id TEXT PRIMARY KEY, category TEXT NOT NULL, description TEXT, rate DOUBLE PRECISION NOT NULL, unit TEXT NOT NULL, is_active INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS request_files (id TEXT PRIMARY KEY, request_id TEXT NOT NULL, filename TEXT NOT NULL, original_name TEXT NOT NULL, mimetype TEXT, size INTEGER, status TEXT DEFAULT 'attached', responsive INTEGER DEFAULT 0, uploaded_by TEXT, uploaded_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')));
CREATE TABLE IF NOT EXISTS agent_rules (id TEXT PRIMARY KEY, rule_text TEXT NOT NULL, enabled INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 100, created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')), created_by TEXT);
CREATE TABLE IF NOT EXISTS demo_documents (id TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT, body TEXT, department TEXT, doc_type TEXT, date_created TEXT, page_count INTEGER, public_availability TEXT DEFAULT 'available', tags TEXT);
CREATE TABLE IF NOT EXISTS email_verifications (token TEXT PRIMARY KEY, email TEXT NOT NULL, created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')), verified_at TEXT, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS record_repositories (id TEXT PRIMARY KEY, name TEXT NOT NULL, connector_type TEXT NOT NULL, status TEXT DEFAULT 'active', config TEXT DEFAULT '{}', sort_order INTEGER DEFAULT 100, created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')));
CREATE TABLE IF NOT EXISTS request_selected_records (id TEXT PRIMARY KEY, request_id TEXT NOT NULL, record_id TEXT NOT NULL, title TEXT, source_system TEXT, public_availability TEXT, created_at TEXT DEFAULT (to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS')));
CREATE INDEX IF NOT EXISTS idx_demodocs_title ON demo_documents(title);
CREATE INDEX IF NOT EXISTS idx_emailverif_email ON email_verifications(email);
CREATE INDEX IF NOT EXISTS idx_files_request ON request_files(request_id);
CREATE INDEX IF NOT EXISTS idx_requests_dept ON requests(department_id);
CREATE INDEX IF NOT EXISTS idx_requests_stage ON requests(stage);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
CREATE INDEX IF NOT EXISTS idx_rules_enabled ON agent_rules(enabled, sort_order);
CREATE INDEX IF NOT EXISTS idx_selected_request ON request_selected_records(request_id);

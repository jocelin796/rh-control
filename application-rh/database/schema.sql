PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  matricule TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  service TEXT NOT NULL,
  direction_name TEXT,
  agency TEXT,
  fonction TEXT,
  status TEXT,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS leave_balances (
  employee_id TEXT PRIMARY KEY,
  initial_days REAL DEFAULT 0,
  acquired_days REAL DEFAULT 0,
  taken_days REAL DEFAULT 0,
  planned_days REAL DEFAULT 0,
  available_days REAL DEFAULT 0,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS contracts (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  type TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  duration TEXT,
  fonction TEXT,
  service TEXT,
  salary REAL DEFAULT 0,
  renewal_date TEXT,
  renewal_count INTEGER DEFAULT 0,
  document TEXT,
  status TEXT,
  sort_order INTEGER DEFAULT 0,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS contract_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id TEXT NOT NULL,
  entry TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  type TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  return_date TEXT,
  days REAL DEFAULT 0,
  reason TEXT,
  comment TEXT,
  attachment TEXT,
  status TEXT,
  created_at TEXT,
  sort_order INTEGER DEFAULT 0,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS leave_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  leave_id TEXT NOT NULL,
  entry TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  FOREIGN KEY (leave_id) REFERENCES leave_requests(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS leave_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  leave_id TEXT NOT NULL,
  entry TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  FOREIGN KEY (leave_id) REFERENCES leave_requests(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  employee_id TEXT,
  leave_id TEXT,
  title TEXT NOT NULL,
  status TEXT,
  created_at TEXT,
  content TEXT,
  sort_order INTEGER DEFAULT 0,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL,
  FOREIGN KEY (leave_id) REFERENCES leave_requests(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_contracts_employee ON contracts(employee_id);
CREATE INDEX IF NOT EXISTS idx_contracts_end_date ON contracts(end_date);
CREATE INDEX IF NOT EXISTS idx_leave_requests_employee ON leave_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_dates ON leave_requests(start_date, end_date, return_date);
CREATE INDEX IF NOT EXISTS idx_documents_leave ON documents(leave_id);

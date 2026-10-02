const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'patrol.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE,
  password_hash TEXT,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('manager','inspector','cleaner','repairer')),
  phone TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  token_cipher TEXT,
  token_hash TEXT UNIQUE,
  token_active INTEGER NOT NULL DEFAULT 0,
  token_updated_at TEXT,
  created_at TEXT NOT NULL,
  created_by INTEGER
);
CREATE TABLE IF NOT EXISTS issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  location_type TEXT NOT NULL CHECK(location_type IN ('elevator_hall','corridor','garbage_room')),
  location_detail TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  points INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','submitted','approved','rejected')),
  inspector_id INTEGER NOT NULL REFERENCES staff(id),
  assignee_id INTEGER NOT NULL REFERENCES staff(id),
  due_at TEXT,
  submitted_at TEXT,
  submitted_note TEXT NOT NULL DEFAULT '',
  reviewed_by INTEGER REFERENCES staff(id),
  reviewed_at TEXT,
  review_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('before','after')),
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  uploaded_by INTEGER,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER,
  actor_name TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
CREATE INDEX IF NOT EXISTS idx_issues_assignee ON issues(assignee_id);
CREATE INDEX IF NOT EXISTS idx_photos_issue ON photos(issue_id);
CREATE INDEX IF NOT EXISTS idx_logs_created ON logs(created_at);
`);

module.exports = { db, DATA_DIR, UPLOAD_DIR, ROOT };

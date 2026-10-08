const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const dir = path.join(__dirname, "database");
fs.mkdirSync(dir, { recursive: true });
const db = new Database(path.join(dir, "attendance.db"));
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  description TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE,
  username TEXT UNIQUE,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'section',
  section_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(section_id) REFERENCES sections(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  school_name TEXT DEFAULT '',
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  class_name TEXT DEFAULT '',
  section_id INTEGER,
  qr_token TEXT UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(section_id) REFERENCES sections(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  section_id INTEGER,
  FOREIGN KEY(section_id) REFERENCES sections(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  course_id INTEGER,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Present',
  method TEXT NOT NULL DEFAULT 'QR',
  recorded_by INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,
  FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE SET NULL,
  FOREIGN KEY(recorded_by) REFERENCES users(id) ON DELETE SET NULL
);
`);

function hasTableColumn(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);
}
function addColumn(table, column, definition) {
  if (!hasTableColumn(table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

/* Migrate the original project schema safely. */
addColumn("users", "email", "TEXT");
addColumn("users", "section_id", "INTEGER");
addColumn("users", "created_at", "TEXT");
addColumn("students", "school_name", "TEXT DEFAULT ''");
addColumn("students", "section_id", "INTEGER");
addColumn("students", "qr_token", "TEXT");
addColumn("students", "active", "INTEGER NOT NULL DEFAULT 1");
addColumn("courses", "section_id", "INTEGER");
addColumn("attendance", "recorded_by", "INTEGER");

const bcrypt = require("bcryptjs");

function hashIfNeeded(row) {
  if (row && row.password && !row.password.startsWith("$2")) {
    db.prepare("UPDATE users SET password=? WHERE id=?").run(bcrypt.hashSync(row.password, 10), row.id);
  }
}

/* Convert the old admin account to an email-based admin account. */
let admin = db.prepare("SELECT * FROM users WHERE role='admin' OR username='admin' OR email='admin@pmm.local' LIMIT 1").get();
if (!admin) {
  const hash = bcrypt.hashSync("admin123", 10);
  db.prepare("INSERT INTO users(email,username,password,role) VALUES(?,?,?,'admin')")
    .run("admin@pmm.local", "admin", hash);
} else {
  const email = admin.email || "admin@pmm.local";
  db.prepare("UPDATE users SET email=?, role='admin' WHERE id=?").run(email, admin.id);
  hashIfNeeded(db.prepare("SELECT * FROM users WHERE id=?").get(admin.id));
}

/* Hash any legacy plaintext section/teacher passwords. */
for (const u of db.prepare("SELECT * FROM users").all()) hashIfNeeded(u);

if (db.prepare("SELECT COUNT(*) c FROM sections").get().c === 0) {
  db.prepare("INSERT INTO sections(name,description) VALUES (?,?)")
    .run("General", "General student section");
}

const general = db.prepare("SELECT id FROM sections WHERE name='General'").get();
if (general) {
  db.prepare("UPDATE students SET section_id=? WHERE section_id IS NULL").run(general.id);
  db.prepare("UPDATE courses SET section_id=? WHERE section_id IS NULL").run(general.id);
}

/* Give old students stable QR tokens and keep their existing IDs. */
const crypto = require("crypto");
for (const s of db.prepare("SELECT id FROM students WHERE qr_token IS NULL OR qr_token=''").all()) {
  db.prepare("UPDATE students SET qr_token=? WHERE id=?")
    .run(crypto.randomUUID(), s.id);
}

if (db.prepare("SELECT COUNT(*) c FROM courses").get().c === 0) {
  db.prepare("INSERT INTO courses(name,section_id) VALUES (?,?)").run("General Class", general ? general.id : null);
}

module.exports = db;

import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = process.env.SQLITE_DB_PATH || path.join(dataDir, 'app.db');
export const db = new DatabaseSync(dbPath);

// WAL mode allows one writer + concurrent readers across multiple processes
// accessing the same file (e.g. the running app server and a Playwright test
// process that seeds/reads rows directly via this module) without the
// default rollback-journal mode's "database is locked" contention. busy_timeout
// makes a connection retry for up to 5s instead of failing immediately when
// two writers do briefly collide, rather than surfacing a transient
// SQLITE_BUSY as an error. Both are standard SQLite settings, not
// schema/behavior changes.
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA busy_timeout = 5000;');

// Schema
// orders: local record of a Razorpay order and its current lifecycle state
// refunds: one row per Razorpay refund (supports multiple partial refunds per payment)
// webhook_events: durable idempotency + audit log for received webhooks
db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    amount INTEGER NOT NULL,
    currency TEXT NOT NULL,
    status TEXT NOT NULL,
    payment_id TEXT,
    payment_status TEXT,
    receipt TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS refunds (
    refund_id TEXT PRIMARY KEY,
    payment_id TEXT NOT NULL,
    order_id TEXT,
    amount INTEGER NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS webhook_events (
    event_id TEXT PRIMARY KEY,
    event_type TEXT,
    payment_id TEXT,
    order_id TEXT,
    amount INTEGER,
    status TEXT,
    source TEXT NOT NULL DEFAULT 'unknown',
    received_at TEXT NOT NULL
  );
`);

export default db;

// Uses Node's built-in SQLite (Node 22.13+), so there is nothing to compile on install.
const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(process.env.DB_PATH || './tickets.db');
db.exec('PRAGMA journal_mode = WAL');

db.exec(`CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT UNIQUE NOT NULL,
  owner_id TEXT NOT NULL,
  claimed_by TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL,
  closed_at INTEGER
)`);

module.exports = {
  create: (channelId, ownerId) =>
    db.prepare('INSERT INTO tickets (channel_id, owner_id, created_at) VALUES (?, ?, ?)')
      .run(channelId, ownerId, Date.now()).lastInsertRowid,
  openByOwner: ownerId =>
    db.prepare("SELECT * FROM tickets WHERE owner_id = ? AND status = 'open'").get(ownerId),
  byChannel: channelId =>
    db.prepare('SELECT * FROM tickets WHERE channel_id = ?').get(channelId),
  claim: (channelId, staffId) =>
    db.prepare('UPDATE tickets SET claimed_by = ? WHERE channel_id = ?').run(staffId, channelId),
  close: channelId =>
    db.prepare("UPDATE tickets SET status = 'closed', closed_at = ? WHERE channel_id = ? AND status = 'open'")
      .run(Date.now(), channelId),
  stats: () =>
    db.prepare(`SELECT COUNT(*) AS total,
      COALESCE(SUM(status = 'open'), 0) AS open,
      COALESCE(SUM(status = 'closed'), 0) AS closed FROM tickets`).get()
};

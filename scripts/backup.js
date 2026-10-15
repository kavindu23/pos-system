import { DatabaseSync, backup } from "node:sqlite";
import { mkdirSync, chmodSync, unlinkSync } from "node:fs";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";

// Use SQLite's online backup API: copying only pos.sqlite can miss WAL writes.
const source = join(resolve(process.env.DATA_DIR || "data"), "pos.sqlite");
const destination = resolve(process.argv[2] || "backups");
mkdirSync(destination, { recursive: true, mode: 0o700 });
const filename = join(destination,
  `pos-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}.sqlite`);
process.umask(0o077);
const db = new DatabaseSync(source, { readOnly: true });
try {
  await backup(db, filename);
  chmodSync(filename, 0o600);
  const snapshot = new DatabaseSync(filename);
  try {
    snapshot.exec("PRAGMA journal_mode=DELETE;");
    const result = snapshot.prepare("PRAGMA integrity_check").get();
    if (result.integrity_check !== "ok") throw new Error("Backup integrity check failed");
  } finally {
    snapshot.close();
  }
  console.log(filename);
} catch (error) {
  try { unlinkSync(filename); } catch {}
  throw error;
} finally {
  db.close();
}

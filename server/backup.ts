import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { db, DB_PATH } from './db.ts';
import { backupsToDelete, todayISO } from './logic.ts';

// A copy of the database once a day, beside the manual backups, keeping the last two weeks.
const DIR = resolve(dirname(DB_PATH), '..', 'backups');

function backUp() {
  try {
    mkdirSync(DIR, { recursive: true });
    const file = join(DIR, `auto-${todayISO()}.db`);
    if (!existsSync(file)) {
      db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
      console.log(`Backed up the database to ${file}`);
    }
    for (const old of backupsToDelete(readdirSync(DIR))) rmSync(join(DIR, old));
  } catch (e) {
    console.error('Backup failed:', (e as Error).message);
  }
}

/** Back up now, then check again every hour, so a server left running still gets a copy each day. */
export function startBackups() {
  backUp();
  setInterval(backUp, 60 * 60 * 1000).unref();
}

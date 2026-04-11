#!/usr/bin/env node
/**
 * Delete an account and unlink its videos from manifests.
 *
 * Usage:
 *   node scripts/delete-account.js <username-or-id>
 *   node scripts/delete-account.js <username-or-id> --delete-videos
 *
 * --delete-videos  Also deletes the video files and manifests from disk (irreversible).
 * Without that flag, videos are kept but unlinked from the account.
 */

import { createInterface } from 'readline';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { rm } from 'fs/promises';
import Database from 'better-sqlite3';
import { listManifests, readManifest, writeManifest } from '../src/services/storage.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '../data/db.sqlite');

const arg = process.argv[2];
const deleteVideos = process.argv.includes('--delete-videos');

if (!arg) {
  console.error('Usage: node scripts/delete-account.js <username-or-id> [--delete-videos]');
  process.exit(1);
}

const db = new Database(DB_PATH);

// Look up by id or username or ig_username
const account =
  db.prepare('SELECT * FROM accounts WHERE id = ?').get(arg) ||
  db.prepare('SELECT * FROM accounts WHERE username = ?').get(arg) ||
  db.prepare('SELECT * FROM accounts WHERE ig_username = ?').get(arg) ||
  db.prepare('SELECT * FROM accounts WHERE tt_username = ?').get(arg);

if (!account) {
  console.error(`No account found matching: ${arg}`);
  process.exit(1);
}

console.log('\nFound account:');
console.log(`  id:           ${account.id}`);
console.log(`  username:     ${account.username}`);
console.log(`  display_name: ${account.display_name || '—'}`);
console.log(`  ig_username:  ${account.ig_username || '—'}`);
console.log(`  tt_username:  ${account.tt_username || '—'}`);
console.log(`  type_tag:     ${account.type_tag || '—'}`);

// Find linked video manifests
const manifests = await listManifests();
const linked = manifests.filter((m) => m.accountId === account.id);

console.log(`\nLinked videos: ${linked.length}`);
if (linked.length > 0) {
  for (const m of linked.slice(0, 10)) {
    console.log(`  ${m.id}  ${m.status.padEnd(12)}  ${(m.title || m.url || '').slice(0, 60)}`);
  }
  if (linked.length > 10) console.log(`  … and ${linked.length - 10} more`);
}

if (deleteVideos && linked.length > 0) {
  console.log('\n⚠️  --delete-videos is set: video files + manifests will be permanently deleted.');
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = await new Promise((resolve) => {
  const action = deleteVideos
    ? `delete account + DELETE ${linked.length} video(s) from disk`
    : `delete account + unlink ${linked.length} video(s)`;
  rl.question(`\nProceed to ${action}? [y/N] `, resolve);
});
rl.close();

if (answer.trim().toLowerCase() !== 'y') {
  console.log('Aborted.');
  process.exit(0);
}

// Delete account from DB
db.prepare('DELETE FROM accounts WHERE id = ?').run(account.id);
console.log(`\nDeleted account ${account.id} from database.`);

// Handle linked videos
if (deleteVideos) {
  const DATA_DIR = join(__dirname, '../data/videos');
  let deleted = 0;
  for (const m of linked) {
    try {
      await rm(join(DATA_DIR, m.id), { recursive: true, force: true });
      deleted++;
    } catch (e) {
      console.warn(`  Could not delete ${m.id}: ${e.message}`);
    }
  }
  console.log(`Deleted ${deleted} video director${deleted !== 1 ? 'ies' : 'y'} from disk.`);
} else {
  let unlinked = 0;
  for (const m of linked) {
    try {
      const full = await readManifest(m.id);
      delete full.accountId;
      delete full.accountUsername;
      delete full.accountDisplayName;
      delete full.isAccountPull;
      await writeManifest(m.id, full);
      unlinked++;
    } catch (e) {
      console.warn(`  Could not unlink ${m.id}: ${e.message}`);
    }
  }
  console.log(`Unlinked ${unlinked} video manifest${unlinked !== 1 ? 's' : ''}.`);
}

console.log('\nDone.');

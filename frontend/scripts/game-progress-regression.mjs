import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { buildGameProgressSnapshot } from '../src/core/gameProgress.js';

function parseArgs(argv) {
  const cwd = process.cwd();
  return {
    api: argv.includes('--api') ? argv[argv.indexOf('--api') + 1] : 'http://127.0.0.1:8001',
    save: argv.includes('--save')
      ? path.resolve(cwd, argv[argv.indexOf('--save') + 1])
      : path.resolve(cwd, '../backend/local_artifacts/Unbound.sav'),
  };
}

async function backendRequest(baseUrl, pathname, options = {}) {
  const res = await fetch(`${baseUrl}${pathname}`, options);
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new Error(`${pathname} failed (${res.status}): ${JSON.stringify(body)}`);
  }
  return body;
}

async function uploadSave(baseUrl, bytes, name) {
  const form = new FormData();
  form.append('file', new Blob([bytes]), name);
  await backendRequest(baseUrl, '/upload', { method: 'POST', body: form });
}

function stableSnapshot(snapshot) {
  return {
    badge_count: snapshot.badge_count,
    active_level_cap: snapshot.active_level_cap,
    normal_level_cap: snapshot.normal_level_cap,
    expert_level_cap: snapshot.expert_level_cap,
    cap_profile: snapshot.cap_profile,
    effective_level_cap: snapshot.effective_level_cap,
    difficulty_flag_known: snapshot.difficulty_flag_known,
    is_champion: snapshot.is_champion,
    mega_unlocked: snapshot.mega_unlocked,
    money: snapshot.money,
    battle_points: snapshot.battle_points,
    tm_case_owned: snapshot.tm_case_owned,
    owned_tmhm_item_ids: snapshot.owned_tmhm_item_ids,
    key_items: snapshot.key_items,
    consumables: snapshot.consumables,
  };
}

function assertEqual(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label} mismatch\nactual=${a}\nexpected=${e}`);
  }
  console.log(`[PASS] ${label}`);
}

async function main() {
  const args = parseArgs(process.argv);
  const bytes = new Uint8Array(await fs.readFile(args.save));
  await uploadSave(args.api, bytes, path.basename(args.save));

  for (const profile of ['normal', 'expert']) {
    const backend = await backendRequest(args.api, `/game-progress?cap_profile=${profile}`);
    const local = buildGameProgressSnapshot(bytes, { capProfile: profile });
    assertEqual(`game progress backend/local ${profile}`, stableSnapshot(backend.game_progress), stableSnapshot(local));
  }

  console.log('\n[RESULT] ALL CHECKS PASSED');
}

main().catch((err) => {
  console.error('[FATAL]', err?.stack || err);
  process.exit(1);
});

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { unzipSync } from 'fflate';
import {
  DEFAULT_PROFILES,
  buildCandidatesFromPair,
  buildManifest,
  buildQuickCandidatesFromSingle,
} from '../src/core/rtc.js';

function parseArgs(argv) {
  const cwd = process.cwd();
  const out = {
    api: 'http://127.0.0.1:8001',
    broken: path.resolve(cwd, '../backend/local_artifacts/Unbound_2_before_promote_working.sav'),
    fixed: path.resolve(cwd, '../backend/local_artifacts/Unbound_2_fixed.sav'),
    quickManifest: path.resolve(cwd, 'public/data/rtc_manifest_unbound_v1.json'),
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--api' && argv[i + 1]) {
      out.api = argv[++i];
    } else if (arg === '--broken' && argv[i + 1]) {
      out.broken = path.resolve(cwd, argv[++i]);
    } else if (arg === '--fixed' && argv[i + 1]) {
      out.fixed = path.resolve(cwd, argv[++i]);
    } else if (arg === '--quick-manifest' && argv[i + 1]) {
      out.quickManifest = path.resolve(cwd, argv[++i]);
    }
  }
  return out;
}

function toStem(filePath) {
  return path.basename(filePath).replace(/\.[^.]+$/, '');
}

function assert(cond, message) {
  if (!cond) {
    throw new Error(message);
  }
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

async function postMultipart(url, fields) {
  const form = new FormData();
  for (const [name, { bytes, filename }] of Object.entries(fields)) {
    form.append(name, new Blob([bytes]), filename);
  }

  const res = await fetch(url, { method: 'POST', body: form });
  const body = new Uint8Array(await res.arrayBuffer());
  if (!res.ok) {
    throw new Error(`Request failed ${url}: HTTP ${res.status}`);
  }
  return body;
}

function parseJsonFromZipEntry(entries, name) {
  assert(entries[name], `Missing zip entry: ${name}`);
  return JSON.parse(Buffer.from(entries[name]).toString('utf-8'));
}

function sortJson(value) {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortJson(value[key]);
    }
    return out;
  }
  return value;
}

async function runPairParity({ api, brokenPath, fixedPath }) {
  const broken = new Uint8Array(await fs.readFile(brokenPath));
  const fixed = new Uint8Array(await fs.readFile(fixedPath));
  const stem = toStem(brokenPath);

  const localManifest = buildManifest(broken, fixed);
  const localCandidates = buildCandidatesFromPair(broken, fixed, localManifest, DEFAULT_PROFILES);

  const zipBytes = await postMultipart(`${api}/rtc/repair-candidates`, {
    broken: { bytes: broken, filename: path.basename(brokenPath) },
    fixed: { bytes: fixed, filename: path.basename(fixedPath) },
  });
  const zipEntries = unzipSync(zipBytes);

  const backendManifest = parseJsonFromZipEntry(zipEntries, `${stem}_rtc_manifest.json`);
  const backendSummary = parseJsonFromZipEntry(zipEntries, `${stem}_rtc_summary.json`);

  assert(
    JSON.stringify(sortJson(localManifest)) === JSON.stringify(sortJson(backendManifest)),
    'Pair manifest mismatch (local vs backend)',
  );
  assert(Array.isArray(backendSummary.fallback_order), 'Pair summary fallback_order missing');
  assert(JSON.stringify(backendSummary.fallback_order) === JSON.stringify(DEFAULT_PROFILES), 'Pair summary fallback order mismatch');

  for (const profile of DEFAULT_PROFILES) {
    const entryName = `${stem}_rtc_${profile}.sav`;
    const backendBytes = zipEntries[entryName];
    assert(backendBytes, `Missing backend pair candidate ${entryName}`);
    const localBytes = localCandidates[profile].bytes;
    assert(bytesEqual(localBytes, backendBytes), `Pair candidate mismatch for profile ${profile}`);
  }

  return {
    stem,
    localCandidates,
    backendEntries: zipEntries,
  };
}

async function runQuickParity({ api, brokenPath, manifestPath, pairArtifacts }) {
  const broken = new Uint8Array(await fs.readFile(brokenPath));
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
  const stem = toStem(brokenPath);

  const localResult = buildQuickCandidatesFromSingle(broken, manifest);

  const zipBytes = await postMultipart(`${api}/rtc/quick-fix`, {
    file: { bytes: broken, filename: path.basename(brokenPath) },
  });
  const zipEntries = unzipSync(zipBytes);

  const backendSummary = parseJsonFromZipEntry(zipEntries, `${stem}_rtc_quick_summary.json`);
  assert(Number(backendSummary.source_idx) === Number(localResult.source_idx), 'Quick summary source_idx mismatch');
  assert(Number(backendSummary.target_idx) === Number(localResult.target_idx), 'Quick summary target_idx mismatch');

  for (const [profile, localBytes] of Object.entries(localResult.candidates)) {
    const entryName = `${stem}_${profile}.sav`;
    const backendBytes = zipEntries[entryName];
    assert(backendBytes, `Missing backend quick candidate ${entryName}`);
    assert(bytesEqual(localBytes, backendBytes), `Quick candidate mismatch for profile ${profile}`);
  }

  const quickToPair = {
    quick_id0_id4: 'id0_id4_full',
    quick_id0_id4_id13: 'id0_id4_id13_full',
    quick_id0_id4_id13_aux12: 'id0_id4_id13_full_plus_aux12',
  };

  for (const [quickName, pairName] of Object.entries(quickToPair)) {
    const localQuick = localResult.candidates[quickName];
    const localPair = pairArtifacts.localCandidates[pairName].bytes;
    assert(bytesEqual(localQuick, localPair), `Local quick candidate ${quickName} does not match pair profile ${pairName}`);

    const backendQuick = zipEntries[`${stem}_${quickName}.sav`];
    const backendPair = pairArtifacts.backendEntries[`${stem}_rtc_${pairName}.sav`];
    assert(backendQuick && backendPair, `Missing backend mapping entries for ${quickName} -> ${pairName}`);
    assert(bytesEqual(backendQuick, backendPair), `Backend quick candidate ${quickName} does not match pair profile ${pairName}`);
  }
}

async function main() {
  const args = parseArgs(process.argv);

  const pairArtifacts = await runPairParity({
    api: args.api,
    brokenPath: args.broken,
    fixedPath: args.fixed,
  });
  console.log('[PASS] rtc pair parity local vs backend');

  await runQuickParity({
    api: args.api,
    brokenPath: args.broken,
    manifestPath: args.quickManifest,
    pairArtifacts,
  });
  console.log('[PASS] rtc quick parity local vs backend');

  console.log('\n[RESULT] ALL CHECKS PASSED');
}

main().catch((err) => {
  console.error('[FATAL]', err?.stack || err);
  process.exit(1);
});

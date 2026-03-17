import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  getParty,
  updatePartyAbilitySwitch,
  updatePartyIdentity,
  updatePartyLevel,
  updatePartyNature,
} from '../src/core/party.js';
import {
  loadPcContext,
  getPcBox,
  editPcMonFull,
} from '../src/core/pc.js';
import { getExpAtLevel, getSpeciesGrowthRate } from '../src/core/growth.js';

function parseArgs(argv) {
  const out = {
    api: 'http://127.0.0.1:8001',
    save: path.resolve(process.cwd(), '../backend/local_artifacts/Unbound.sav'),
    species: path.resolve(process.cwd(), 'public/data/pokemon.txt'),
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--api' && argv[i + 1]) {
      out.api = argv[++i];
    } else if (arg === '--save' && argv[i + 1]) {
      out.save = path.resolve(process.cwd(), argv[++i]);
    } else if (arg === '--species' && argv[i + 1]) {
      out.species = path.resolve(process.cwd(), argv[++i]);
    }
  }

  return out;
}

function parseSpeciesMap(text) {
  const map = new Map();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || !line.includes(':')) continue;
    const idx = line.indexOf(':');
    const id = Number.parseInt(line.slice(0, idx), 10);
    if (!Number.isNaN(id)) {
      map.set(id, line.slice(idx + 1).trim());
    }
  }
  return map;
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
  return { ok: res.ok, status: res.status, body };
}

async function uploadSave(baseUrl, saveBytes) {
  const form = new FormData();
  form.append('file', new Blob([saveBytes]), 'identity_test.sav');
  const { ok, status, body } = await backendRequest(baseUrl, '/upload', {
    method: 'POST',
    body: form,
  });
  if (!ok) {
    throw new Error(`Upload failed (${status}): ${JSON.stringify(body)}`);
  }
}

function pickCandidates(party) {
  const dynamicStd = party.find((p) => p.gender_mode === 'dynamic' && p.current_ability_index !== 2);
  const dynamicAny = party.find((p) => p.gender_mode === 'dynamic');
  const dynamicHa = party.find((p) => p.gender_mode === 'dynamic' && p.current_ability_index === 2) || null;
  const fixedOrGenderless = party.find((p) => p.gender_mode !== 'dynamic') || null;

  return {
    dynamicStd: dynamicStd || dynamicAny || null,
    dynamicHa,
    fixedOrGenderless,
  };
}

function pickPcCandidates(pcMons) {
  const dynamicStd = pcMons.find((p) => p.gender_mode === 'dynamic' && p.current_ability_index !== 2);
  const dynamicAny = pcMons.find((p) => p.gender_mode === 'dynamic');
  const dynamicHa = pcMons.find((p) => p.gender_mode === 'dynamic' && p.current_ability_index === 2) || null;
  const fixedOrGenderless = pcMons.find((p) => p.gender_mode !== 'dynamic') || null;

  return {
    dynamicStd: dynamicStd || dynamicAny || null,
    dynamicHa,
    fixedOrGenderless,
  };
}

function compareCore(a, b) {
  const keys = ['species_id', 'nature_id', 'current_ability_index', 'is_shiny', 'gender'];
  return keys.every((k) => a?.[k] === b?.[k]);
}

function assertInvariant(before, after, options = {}) {
  const errors = [];
  if (before.species_id !== after.species_id) errors.push('species drifted');
  if (options.expectNaturePreserved && before.nature_id !== after.nature_id) errors.push('nature not preserved');
  if (options.expectAbilityPreserved && before.current_ability_index !== after.current_ability_index) {
    errors.push('ability slot/HA not preserved');
  }
  if (options.expectedShiny !== undefined && Boolean(after.is_shiny) !== Boolean(options.expectedShiny)) {
    errors.push(`shiny expected=${options.expectedShiny} got=${after.is_shiny}`);
  }
  if (options.expectedGender && after.gender !== options.expectedGender) {
    errors.push(`gender expected=${options.expectedGender} got=${after.gender}`);
  }
  return errors;
}

async function main() {
  const args = parseArgs(process.argv);
  const speciesText = await fs.readFile(args.species, 'utf-8');
  const speciesMap = parseSpeciesMap(speciesText);
  const saveBytes = await fs.readFile(args.save);

  const report = [];
  let failures = 0;

  async function initState() {
    await uploadSave(args.api, saveBytes);
    const backendPartyRes = await backendRequest(args.api, '/party');
    if (!backendPartyRes.ok) {
      throw new Error(`GET /party failed (${backendPartyRes.status}): ${JSON.stringify(backendPartyRes.body)}`);
    }
    const backendParty = backendPartyRes.body;
    const localBuffer = new Uint8Array(saveBytes);
    const localParty = getParty(localBuffer, speciesMap);
    return { backendParty, localBuffer, localParty };
  }

  async function initPcState() {
    await uploadSave(args.api, saveBytes);
    const loadRes = await backendRequest(args.api, '/pc/load');
    if (!loadRes.ok) {
      throw new Error(`GET /pc/load failed (${loadRes.status}): ${JSON.stringify(loadRes.body)}`);
    }

    const backendBoxes = [];
    for (let boxId = 1; boxId <= 26; boxId += 1) {
      const boxRes = await backendRequest(args.api, `/pc/box/${boxId}`);
      if (!boxRes.ok) {
        throw new Error(`GET /pc/box/${boxId} failed (${boxRes.status}): ${JSON.stringify(boxRes.body)}`);
      }
      backendBoxes.push(...boxRes.body);
    }

    const localBuffer = new Uint8Array(saveBytes);
    const localContext = loadPcContext(localBuffer);
    const localBoxes = [];
    for (let boxId = 1; boxId <= 26; boxId += 1) {
      localBoxes.push(...getPcBox(localContext, boxId, speciesMap));
    }

    return { backendBoxes, localBuffer, localContext, localBoxes };
  }

  async function backendMon(index) {
    const res = await backendRequest(args.api, '/party');
    if (!res.ok) throw new Error(`GET /party failed (${res.status})`);
    return res.body[index];
  }

  function localMon(localBuffer, index) {
    return getParty(localBuffer, speciesMap)[index];
  }

  async function backendPcMon(box, slot) {
    const res = await backendRequest(args.api, `/pc/box/${box}`);
    if (!res.ok) throw new Error(`GET /pc/box/${box} failed (${res.status})`);
    return res.body.find((m) => Number(m.box) === Number(box) && Number(m.slot) === Number(slot));
  }

  function localPcMon(localContext, box, slot) {
    return getPcBox(localContext, Number(box), speciesMap).find((m) => Number(m.box) === Number(box) && Number(m.slot) === Number(slot));
  }

  const first = await initState();
  const candidates = pickCandidates(first.backendParty);

  report.push(`[info] candidates dynamicStd=${candidates.dynamicStd?.index ?? 'none'} dynamicHa=${candidates.dynamicHa?.index ?? 'none'} fixedOrGenderless=${candidates.fixedOrGenderless?.index ?? 'none'}`);

  // Scenario 0: baseline parity
  {
    const sameLen = first.backendParty.length === first.localParty.length;
    const sameRows = sameLen && first.backendParty.every((b, i) => compareCore(b, first.localParty[i]));
    if (!sameRows) {
      failures += 1;
      report.push('[FAIL] baseline backend/local party core fields mismatch');
    } else {
      report.push('[PASS] baseline backend/local party core fields match');
    }
  }

  // Scenario 1: shiny toggle only on dynamic standard mon
  if (candidates.dynamicStd) {
    const idx = candidates.dynamicStd.index;
    const state = await initState();
    const b0 = state.backendParty[idx];
    const l0 = state.localParty[idx];
    const targetShiny = !Boolean(b0.is_shiny);

    await backendRequest(args.api, `/party/${idx}/identity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shiny: targetShiny }),
    });
    updatePartyIdentity(state.localBuffer, idx, { shiny: targetShiny });

    const b1 = await backendMon(idx);
    const l1 = localMon(state.localBuffer, idx);

    const invB = assertInvariant(b0, b1, {
      expectNaturePreserved: true,
      expectAbilityPreserved: true,
      expectedShiny: targetShiny,
      expectedGender: b0.gender,
    });
    const invL = assertInvariant(l0, l1, {
      expectNaturePreserved: true,
      expectAbilityPreserved: true,
      expectedShiny: targetShiny,
      expectedGender: l0.gender,
    });

    if (invB.length || invL.length || !compareCore(b1, l1)) {
      failures += 1;
      report.push(`[FAIL] shiny toggle idx=${idx} backend=${invB.join('; ') || 'ok'} local=${invL.join('; ') || 'ok'} parity=${compareCore(b1, l1)}`);
    } else {
      report.push(`[PASS] shiny toggle idx=${idx}`);
    }
  } else {
    report.push('[SKIP] shiny toggle: no dynamic party mon found');
  }

  // Scenario 2: gender toggle only on dynamic standard mon
  if (candidates.dynamicStd) {
    const idx = candidates.dynamicStd.index;
    const state = await initState();
    const b0 = state.backendParty[idx];
    const l0 = state.localParty[idx];
    const targetGender = b0.gender === 'male' ? 'female' : 'male';

    await backendRequest(args.api, `/party/${idx}/identity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gender: targetGender }),
    });
    updatePartyIdentity(state.localBuffer, idx, { gender: targetGender });

    const b1 = await backendMon(idx);
    const l1 = localMon(state.localBuffer, idx);

    const invB = assertInvariant(b0, b1, {
      expectNaturePreserved: true,
      expectAbilityPreserved: true,
      expectedShiny: b0.is_shiny,
      expectedGender: targetGender,
    });
    const invL = assertInvariant(l0, l1, {
      expectNaturePreserved: true,
      expectAbilityPreserved: true,
      expectedShiny: l0.is_shiny,
      expectedGender: targetGender,
    });

    if (invB.length || invL.length || !compareCore(b1, l1)) {
      failures += 1;
      report.push(`[FAIL] gender toggle idx=${idx} backend=${invB.join('; ') || 'ok'} local=${invL.join('; ') || 'ok'} parity=${compareCore(b1, l1)}`);
    } else {
      report.push(`[PASS] gender toggle idx=${idx}`);
    }
  } else {
    report.push('[SKIP] gender toggle: no dynamic party mon found');
  }

  // Scenario 3: combined shiny+gender on dynamic standard mon
  if (candidates.dynamicStd) {
    const idx = candidates.dynamicStd.index;
    const state = await initState();
    const b0 = state.backendParty[idx];
    const l0 = state.localParty[idx];
    const targetGender = b0.gender === 'male' ? 'female' : 'male';
    const targetShiny = !Boolean(b0.is_shiny);

    await backendRequest(args.api, `/party/${idx}/identity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shiny: targetShiny, gender: targetGender }),
    });
    updatePartyIdentity(state.localBuffer, idx, { shiny: targetShiny, gender: targetGender });

    const b1 = await backendMon(idx);
    const l1 = localMon(state.localBuffer, idx);

    const invB = assertInvariant(b0, b1, {
      expectNaturePreserved: true,
      expectAbilityPreserved: true,
      expectedShiny: targetShiny,
      expectedGender: targetGender,
    });
    const invL = assertInvariant(l0, l1, {
      expectNaturePreserved: true,
      expectAbilityPreserved: true,
      expectedShiny: targetShiny,
      expectedGender: targetGender,
    });

    if (invB.length || invL.length || !compareCore(b1, l1)) {
      failures += 1;
      report.push(`[FAIL] combined identity idx=${idx} backend=${invB.join('; ') || 'ok'} local=${invL.join('; ') || 'ok'} parity=${compareCore(b1, l1)}`);
    } else {
      report.push(`[PASS] combined identity idx=${idx}`);
    }
  } else {
    report.push('[SKIP] combined identity: no dynamic party mon found');
  }

  // Scenario 4: HA preservation
  if (candidates.dynamicHa) {
    const idx = candidates.dynamicHa.index;
    const state = await initState();
    const b0 = state.backendParty[idx];
    const l0 = state.localParty[idx];
    const targetGender = b0.gender === 'male' ? 'female' : 'male';
    const targetShiny = !Boolean(b0.is_shiny);

    await backendRequest(args.api, `/party/${idx}/identity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shiny: targetShiny, gender: targetGender }),
    });
    updatePartyIdentity(state.localBuffer, idx, { shiny: targetShiny, gender: targetGender });

    const b1 = await backendMon(idx);
    const l1 = localMon(state.localBuffer, idx);

    const invB = assertInvariant(b0, b1, {
      expectNaturePreserved: true,
      expectAbilityPreserved: true,
      expectedShiny: targetShiny,
      expectedGender: targetGender,
    });
    const invL = assertInvariant(l0, l1, {
      expectNaturePreserved: true,
      expectAbilityPreserved: true,
      expectedShiny: targetShiny,
      expectedGender: targetGender,
    });

    if (invB.length || invL.length || !compareCore(b1, l1)) {
      failures += 1;
      report.push(`[FAIL] HA preservation idx=${idx} backend=${invB.join('; ') || 'ok'} local=${invL.join('; ') || 'ok'} parity=${compareCore(b1, l1)}`);
    } else {
      report.push(`[PASS] HA preservation idx=${idx}`);
    }
  } else {
    report.push('[SKIP] HA preservation: no dynamic HA mon found in party');
  }

  // Scenario 5: invalid gender guard on fixed/genderless
  if (candidates.fixedOrGenderless) {
    const idx = candidates.fixedOrGenderless.index;
    const state = await initState();
    const b0 = state.backendParty[idx];
    const l0 = state.localParty[idx];
    const impossibleGender = b0.gender === 'male' ? 'female' : 'male';

    const badRes = await backendRequest(args.api, `/party/${idx}/identity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gender: impossibleGender }),
    });

    let localError = null;
    try {
      updatePartyIdentity(state.localBuffer, idx, { gender: impossibleGender });
    } catch (e) {
      localError = String(e?.message || e);
    }

    const b1 = await backendMon(idx);
    const l1 = localMon(state.localBuffer, idx);

    const unchangedBackend = compareCore(b0, b1);
    const unchangedLocal = compareCore(l0, l1);
    const backendRejected = !badRes.ok && badRes.status === 400;
    const localRejected = Boolean(localError);

    if (!backendRejected || !localRejected || !unchangedBackend || !unchangedLocal) {
      failures += 1;
      report.push(`[FAIL] invalid gender guard idx=${idx} backendRejected=${backendRejected} localRejected=${localRejected} backendUnchanged=${unchangedBackend} localUnchanged=${unchangedLocal}`);
    } else {
      report.push(`[PASS] invalid gender guard idx=${idx}`);
    }
  } else {
    report.push('[SKIP] invalid gender guard: no fixed/genderless mon found in party');
  }

  // Scenario 6: mixed PID-sensitive sequence
  if (candidates.dynamicStd) {
    const idx = candidates.dynamicStd.index;
    const state = await initState();
    const b0 = state.backendParty[idx];
    const l0 = state.localParty[idx];
    const targetAbility = b0.current_ability_index === 0 ? 1 : 0;
    const targetNature = (b0.nature_id + 7) % 25;
    const targetGender = b0.gender === 'male' ? 'female' : 'male';
    const targetShiny = !Boolean(b0.is_shiny);

    await backendRequest(args.api, `/party/${idx}/ability-switch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ability_index: targetAbility }),
    });
    updatePartyAbilitySwitch(state.localBuffer, idx, { ability_index: targetAbility });

    await backendRequest(args.api, `/party/${idx}/nature`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nature_id: targetNature }),
    });
    updatePartyNature(state.localBuffer, idx, { nature_id: targetNature });

    await backendRequest(args.api, `/party/${idx}/identity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shiny: targetShiny, gender: targetGender }),
    });
    updatePartyIdentity(state.localBuffer, idx, { shiny: targetShiny, gender: targetGender });

    await backendRequest(args.api, `/party/${idx}/identity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shiny: !targetShiny, gender: b0.gender }),
    });
    updatePartyIdentity(state.localBuffer, idx, { shiny: !targetShiny, gender: b0.gender });

    const b1 = await backendMon(idx);
    const l1 = localMon(state.localBuffer, idx);

    const invB = assertInvariant(b0, b1, {
      expectNaturePreserved: false,
      expectAbilityPreserved: false,
      expectedShiny: !targetShiny,
      expectedGender: b0.gender,
    });
    const invL = assertInvariant(l0, l1, {
      expectNaturePreserved: false,
      expectAbilityPreserved: false,
      expectedShiny: !targetShiny,
      expectedGender: l0.gender,
    });
    const mixedChecks = [
      b1.nature_id === targetNature,
      l1.nature_id === targetNature,
      b1.current_ability_index === targetAbility,
      l1.current_ability_index === targetAbility,
    ];

    if (invB.length || invL.length || mixedChecks.includes(false) || !compareCore(b1, l1)) {
      failures += 1;
      report.push(`[FAIL] mixed sequence idx=${idx} backend=${invB.join('; ') || 'ok'} local=${invL.join('; ') || 'ok'} mixedChecks=${JSON.stringify(mixedChecks)} parity=${compareCore(b1, l1)}`);
    } else {
      report.push(`[PASS] mixed sequence idx=${idx}`);
    }
  } else {
    report.push('[SKIP] mixed sequence: no dynamic standard mon found');
  }

  // Scenario 7: party level edit default growth (species mapping)
  {
    const state = await initState();
    const candidate = state.backendParty[0] || null;
    if (!candidate) {
      report.push('[SKIP] party level default growth: no party mons found');
    } else {
      const idx = candidate.index;
      const b0 = state.backendParty[idx];
      const l0 = state.localParty[idx];
      const targetLevel = Math.max(1, Math.min(100, Number((b0.level || 1) + 1)));
      const speciesGrowth = getSpeciesGrowthRate(b0.species_id);

      const backendLevelRes = await backendRequest(args.api, `/party/${idx}/level`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_level: targetLevel, growth_rate: null }),
      });
      updatePartyLevel(state.localBuffer, idx, { target_level: targetLevel, growth_rate: null });

      const b1 = await backendMon(idx);
      const l1 = localMon(state.localBuffer, idx);
      const expectedExp = speciesGrowth === null ? null : getExpAtLevel(speciesGrowth, targetLevel);
      const backendExpOk = expectedExp === null ? true : Number(b1.exp) === Number(expectedExp);
      const localExpOk = expectedExp === null ? true : Number(l1.exp) === Number(expectedExp);
      const invB = assertInvariant(b0, b1, { expectNaturePreserved: true, expectAbilityPreserved: true });
      const invL = assertInvariant(l0, l1, { expectNaturePreserved: true, expectAbilityPreserved: true });
      const backendRateOk = speciesGrowth === null ? true : Number(backendLevelRes.body?.growth_rate) === Number(speciesGrowth);

      if (!backendLevelRes.ok || invB.length || invL.length || !backendExpOk || !localExpOk || !backendRateOk || Number(b1.exp) !== Number(l1.exp)) {
        failures += 1;
        report.push(`[FAIL] party level default growth idx=${idx} backendOk=${backendLevelRes.ok} backendInv=${invB.join('; ') || 'ok'} localInv=${invL.join('; ') || 'ok'} backendExpOk=${backendExpOk} localExpOk=${localExpOk} backendRateOk=${backendRateOk} parityExp=${Number(b1.exp) === Number(l1.exp)}`);
      } else {
        report.push(`[PASS] party level default growth idx=${idx}`);
      }
    }
  }

  const firstPc = await initPcState();
  const pcCandidates = pickPcCandidates(firstPc.backendBoxes);
  report.push(`[info] pc candidates dynamicStd=${pcCandidates.dynamicStd ? `${pcCandidates.dynamicStd.box}:${pcCandidates.dynamicStd.slot}` : 'none'} dynamicHa=${pcCandidates.dynamicHa ? `${pcCandidates.dynamicHa.box}:${pcCandidates.dynamicHa.slot}` : 'none'} fixedOrGenderless=${pcCandidates.fixedOrGenderless ? `${pcCandidates.fixedOrGenderless.box}:${pcCandidates.fixedOrGenderless.slot}` : 'none'}`);

  // PC Scenario 1: shiny toggle
  if (pcCandidates.dynamicStd) {
    const { box, slot } = pcCandidates.dynamicStd;
    const state = await initPcState();
    const b0 = state.backendBoxes.find((m) => m.box === box && m.slot === slot);
    const l0 = state.localBoxes.find((m) => m.box === box && m.slot === slot);
    const targetShiny = !Boolean(b0.is_shiny);

    await backendRequest(args.api, '/pc/edit-full', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ box, slot, shiny: targetShiny }),
    });
    editPcMonFull(state.localContext, { box, slot, shiny: targetShiny });

    const b1 = await backendPcMon(box, slot);
    const l1 = localPcMon(state.localContext, box, slot);
    const invB = assertInvariant(b0, b1, { expectNaturePreserved: true, expectAbilityPreserved: true, expectedShiny: targetShiny, expectedGender: b0.gender });
    const invL = assertInvariant(l0, l1, { expectNaturePreserved: true, expectAbilityPreserved: true, expectedShiny: targetShiny, expectedGender: l0.gender });

    if (invB.length || invL.length || !compareCore(b1, l1)) {
      failures += 1;
      report.push(`[FAIL] pc shiny toggle ${box}:${slot} backend=${invB.join('; ') || 'ok'} local=${invL.join('; ') || 'ok'} parity=${compareCore(b1, l1)}`);
    } else {
      report.push(`[PASS] pc shiny toggle ${box}:${slot}`);
    }
  } else {
    report.push('[SKIP] pc shiny toggle: no dynamic PC mon found');
  }

  // PC Scenario 2: gender toggle
  if (pcCandidates.dynamicStd) {
    const { box, slot } = pcCandidates.dynamicStd;
    const state = await initPcState();
    const b0 = state.backendBoxes.find((m) => m.box === box && m.slot === slot);
    const l0 = state.localBoxes.find((m) => m.box === box && m.slot === slot);
    const targetGender = b0.gender === 'male' ? 'female' : 'male';

    await backendRequest(args.api, '/pc/edit-full', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ box, slot, gender: targetGender }),
    });
    editPcMonFull(state.localContext, { box, slot, gender: targetGender });

    const b1 = await backendPcMon(box, slot);
    const l1 = localPcMon(state.localContext, box, slot);
    const invB = assertInvariant(b0, b1, { expectNaturePreserved: true, expectAbilityPreserved: true, expectedShiny: b0.is_shiny, expectedGender: targetGender });
    const invL = assertInvariant(l0, l1, { expectNaturePreserved: true, expectAbilityPreserved: true, expectedShiny: l0.is_shiny, expectedGender: targetGender });

    if (invB.length || invL.length || !compareCore(b1, l1)) {
      failures += 1;
      report.push(`[FAIL] pc gender toggle ${box}:${slot} backend=${invB.join('; ') || 'ok'} local=${invL.join('; ') || 'ok'} parity=${compareCore(b1, l1)}`);
    } else {
      report.push(`[PASS] pc gender toggle ${box}:${slot}`);
    }
  } else {
    report.push('[SKIP] pc gender toggle: no dynamic PC mon found');
  }

  // PC Scenario 3: combined shiny+gender
  if (pcCandidates.dynamicStd) {
    const { box, slot } = pcCandidates.dynamicStd;
    const state = await initPcState();
    const b0 = state.backendBoxes.find((m) => m.box === box && m.slot === slot);
    const l0 = state.localBoxes.find((m) => m.box === box && m.slot === slot);
    const targetGender = b0.gender === 'male' ? 'female' : 'male';
    const targetShiny = !Boolean(b0.is_shiny);

    await backendRequest(args.api, '/pc/edit-full', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ box, slot, shiny: targetShiny, gender: targetGender }),
    });
    editPcMonFull(state.localContext, { box, slot, shiny: targetShiny, gender: targetGender });

    const b1 = await backendPcMon(box, slot);
    const l1 = localPcMon(state.localContext, box, slot);
    const invB = assertInvariant(b0, b1, { expectNaturePreserved: true, expectAbilityPreserved: true, expectedShiny: targetShiny, expectedGender: targetGender });
    const invL = assertInvariant(l0, l1, { expectNaturePreserved: true, expectAbilityPreserved: true, expectedShiny: targetShiny, expectedGender: targetGender });

    if (invB.length || invL.length || !compareCore(b1, l1)) {
      failures += 1;
      report.push(`[FAIL] pc combined identity ${box}:${slot} backend=${invB.join('; ') || 'ok'} local=${invL.join('; ') || 'ok'} parity=${compareCore(b1, l1)}`);
    } else {
      report.push(`[PASS] pc combined identity ${box}:${slot}`);
    }
  } else {
    report.push('[SKIP] pc combined identity: no dynamic PC mon found');
  }

  // PC Scenario 4: HA preservation
  if (pcCandidates.dynamicHa) {
    const { box, slot } = pcCandidates.dynamicHa;
    const state = await initPcState();
    const b0 = state.backendBoxes.find((m) => m.box === box && m.slot === slot);
    const l0 = state.localBoxes.find((m) => m.box === box && m.slot === slot);
    const targetGender = b0.gender === 'male' ? 'female' : 'male';
    const targetShiny = !Boolean(b0.is_shiny);

    await backendRequest(args.api, '/pc/edit-full', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ box, slot, shiny: targetShiny, gender: targetGender }),
    });
    editPcMonFull(state.localContext, { box, slot, shiny: targetShiny, gender: targetGender });

    const b1 = await backendPcMon(box, slot);
    const l1 = localPcMon(state.localContext, box, slot);
    const invB = assertInvariant(b0, b1, { expectNaturePreserved: true, expectAbilityPreserved: true, expectedShiny: targetShiny, expectedGender: targetGender });
    const invL = assertInvariant(l0, l1, { expectNaturePreserved: true, expectAbilityPreserved: true, expectedShiny: targetShiny, expectedGender: targetGender });

    if (invB.length || invL.length || !compareCore(b1, l1)) {
      failures += 1;
      report.push(`[FAIL] pc HA preservation ${box}:${slot} backend=${invB.join('; ') || 'ok'} local=${invL.join('; ') || 'ok'} parity=${compareCore(b1, l1)}`);
    } else {
      report.push(`[PASS] pc HA preservation ${box}:${slot}`);
    }
  } else {
    report.push('[SKIP] pc HA preservation: no dynamic HA mon found');
  }

  // PC Scenario 5: invalid gender guard
  if (pcCandidates.fixedOrGenderless) {
    const { box, slot } = pcCandidates.fixedOrGenderless;
    const state = await initPcState();
    const b0 = state.backendBoxes.find((m) => m.box === box && m.slot === slot);
    const l0 = state.localBoxes.find((m) => m.box === box && m.slot === slot);
    const impossibleGender = b0.gender === 'male' ? 'female' : 'male';

    const badRes = await backendRequest(args.api, '/pc/edit-full', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ box, slot, gender: impossibleGender }),
    });

    let localError = null;
    try {
      editPcMonFull(state.localContext, { box, slot, gender: impossibleGender });
    } catch (e) {
      localError = String(e?.message || e);
    }

    const b1 = await backendPcMon(box, slot);
    const l1 = localPcMon(state.localContext, box, slot);
    const unchangedBackend = compareCore(b0, b1);
    const unchangedLocal = compareCore(l0, l1);
    const backendRejected = !badRes.ok && badRes.status === 400;
    const localRejected = Boolean(localError);

    if (!backendRejected || !localRejected || !unchangedBackend || !unchangedLocal) {
      failures += 1;
      report.push(`[FAIL] pc invalid gender guard ${box}:${slot} backendRejected=${backendRejected} localRejected=${localRejected} backendUnchanged=${unchangedBackend} localUnchanged=${unchangedLocal}`);
    } else {
      report.push(`[PASS] pc invalid gender guard ${box}:${slot}`);
    }
  } else {
    report.push('[SKIP] pc invalid gender guard: no fixed/genderless PC mon found');
  }

  // PC Scenario 6: mixed sequence nature + identity
  if (pcCandidates.dynamicStd) {
    const { box, slot } = pcCandidates.dynamicStd;
    const state = await initPcState();
    const b0 = state.backendBoxes.find((m) => m.box === box && m.slot === slot);
    const l0 = state.localBoxes.find((m) => m.box === box && m.slot === slot);
    const targetNature = (b0.nature_id + 7) % 25;
    const targetGender = b0.gender === 'male' ? 'female' : 'male';
    const targetShiny = !Boolean(b0.is_shiny);

    await backendRequest(args.api, '/pc/edit-full', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ box, slot, nature_id: targetNature }),
    });
    editPcMonFull(state.localContext, { box, slot, nature_id: targetNature });

    await backendRequest(args.api, '/pc/edit-full', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ box, slot, shiny: targetShiny, gender: targetGender }),
    });
    editPcMonFull(state.localContext, { box, slot, shiny: targetShiny, gender: targetGender });

    await backendRequest(args.api, '/pc/edit-full', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ box, slot, shiny: !targetShiny, gender: b0.gender }),
    });
    editPcMonFull(state.localContext, { box, slot, shiny: !targetShiny, gender: b0.gender });

    const b1 = await backendPcMon(box, slot);
    const l1 = localPcMon(state.localContext, box, slot);

    const invB = assertInvariant(b0, b1, { expectNaturePreserved: false, expectAbilityPreserved: false, expectedShiny: !targetShiny, expectedGender: b0.gender });
    const invL = assertInvariant(l0, l1, { expectNaturePreserved: false, expectAbilityPreserved: false, expectedShiny: !targetShiny, expectedGender: l0.gender });
    const mixedChecks = [
      b1.nature_id === targetNature,
      l1.nature_id === targetNature,
    ];

    if (invB.length || invL.length || mixedChecks.includes(false) || !compareCore(b1, l1)) {
      failures += 1;
      report.push(`[FAIL] pc mixed sequence ${box}:${slot} backend=${invB.join('; ') || 'ok'} local=${invL.join('; ') || 'ok'} mixedChecks=${JSON.stringify(mixedChecks)} parity=${compareCore(b1, l1)}`);
    } else {
      report.push(`[PASS] pc mixed sequence ${box}:${slot}`);
    }
  } else {
    report.push('[SKIP] pc mixed sequence: no dynamic standard PC mon found');
  }

  // PC Scenario 7: default species growth level edit parity
  {
    const state = await initPcState();
    const candidate = state.backendBoxes[0] || null;
    if (!candidate) {
      report.push('[SKIP] pc level default growth: no PC mons found');
    } else {
      const { box, slot } = candidate;
      const b0 = state.backendBoxes.find((m) => m.box === box && m.slot === slot);
      const l0 = state.localBoxes.find((m) => m.box === box && m.slot === slot);
      const speciesGrowth = getSpeciesGrowthRate(b0.species_id);
      const targetLevel = 51;
      const chosenGrowth = speciesGrowth === null ? 0 : speciesGrowth;
      const targetExp = getExpAtLevel(chosenGrowth, targetLevel);

      await backendRequest(args.api, '/pc/edit-full', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ box, slot, exp: targetExp }),
      });
      editPcMonFull(state.localContext, { box, slot, exp: targetExp });

      const b1 = await backendPcMon(box, slot);
      const l1 = localPcMon(state.localContext, box, slot);
      const invB = assertInvariant(b0, b1, { expectNaturePreserved: true, expectAbilityPreserved: true });
      const invL = assertInvariant(l0, l1, { expectNaturePreserved: true, expectAbilityPreserved: true });

      if (invB.length || invL.length || Number(b1.exp) !== Number(targetExp) || Number(l1.exp) !== Number(targetExp) || Number(b1.exp) !== Number(l1.exp)) {
        failures += 1;
        report.push(`[FAIL] pc level default growth ${box}:${slot} backend=${invB.join('; ') || 'ok'} local=${invL.join('; ') || 'ok'} backendExp=${b1.exp} localExp=${l1.exp} targetExp=${targetExp}`);
      } else {
        report.push(`[PASS] pc level default growth ${box}:${slot}`);
      }
    }
  }

  for (const line of report) {
    console.log(line);
  }

  if (failures > 0) {
    console.error(`\n[RESULT] FAILURES=${failures}`);
    process.exit(1);
  }

  console.log('\n[RESULT] ALL CHECKS PASSED');
}

main().catch((err) => {
  console.error('[FATAL]', err?.stack || err);
  process.exit(1);
});

import { ru16, ru32, wu16, wu32 } from './binary.js';

const SECTION_SIZE = 0x1000;
const PAYLOAD_SIZE = 0xFF0;
const SAVE_BODY_LEN = 0x20000;
const SAVE_WITH_TRAILER_LEN = 0x20010;
const OPAQUE_IDS = new Set([0, 4, 13]);
const UNBOUND_SECTION_SIGNATURE = 0x01121999;
const TIME_FIXER_SECTION_ID = 4;
const TIME_FIXER_REL_OFF = 0xE89;
const TIME_FIXER_USED_MASK = 0x20;

export const DEFAULT_PROFILES = [
    'control',
    'id0_full',
    'id0_id13_full',
    'id0_id4_full',
    'id0_id4_id13_full',
    'id0_full_plus_aux12',
    'id0_id4_id13_full_plus_aux12',
];

const QUICK_PROFILES = {
    quick_id0_id4: [0, 4],
    quick_id0_id4_id13: [0, 4, 13],
    quick_id0_id4_id13_aux12: [0, 4, 13, 1, 2],
};

function iterSections(buffer) {
    const bodyLen = Math.min(buffer.length, SAVE_BODY_LEN);
    const out = [];
    for (let off = 0; off < bodyLen; off += SECTION_SIZE) {
        out.push({
            off,
            id: ru16(buffer, off + 0xFF4),
            save_idx: ru32(buffer, off + 0xFFC),
            valid_len: ru32(buffer, off + 0xFF0),
            checksum: ru16(buffer, off + 0xFF6),
        });
    }
    return out;
}

function latestById(buffer) {
    const out = {};
    for (const section of iterSections(buffer)) {
        const sid = section.id;
        if (!Object.prototype.hasOwnProperty.call(out, sid) || section.save_idx > out[sid].save_idx) {
            out[sid] = section;
        }
    }
    return out;
}

function sectionsById(buffer) {
    const out = {};
    for (const section of iterSections(buffer)) {
        const sid = section.id;
        if (!Object.prototype.hasOwnProperty.call(out, sid)) {
            out[sid] = [];
        }
        out[sid].push(section);
    }
    for (const sid of Object.keys(out)) {
        out[sid].sort((a, b) => b.save_idx - a.save_idx);
    }
    return out;
}

function gbaChecksum(buffer, offset, length) {
    const fullLength = length - (length % 4);
    let total = 0;
    for (let i = 0; i < fullLength; i += 4) {
        total = (total + ru32(buffer, offset + i)) >>> 0;
    }

    if (length % 4) {
        const rem = length % 4;
        const b0 = buffer[offset + fullLength] || 0;
        const b1 = rem > 1 ? (buffer[offset + fullLength + 1] || 0) : 0;
        const b2 = rem > 2 ? (buffer[offset + fullLength + 2] || 0) : 0;
        const tail = (b0 | (b1 << 8) | (b2 << 16)) >>> 0;
        total = (total + tail) >>> 0;
    }

    return (((total >>> 16) + (total & 0xFFFF)) & 0xFFFF) >>> 0;
}

function recalcStandardChecksum(buffer, sectionOffset) {
    const validLen = ru32(buffer, sectionOffset + 0xFF0);
    const checksumLen = (validLen === 0 || validLen > 0xFF4) ? 0xFF4 : validLen;
    const checksum = gbaChecksum(buffer, sectionOffset, checksumLen);
    wu16(buffer, sectionOffset + 0xFF6, checksum);
}

function writeSectionFromSource(out, dstSection, srcBuffer, srcSection, sid, targetIdx) {
    const dstOff = dstSection.off;
    const srcOff = srcSection.off;

    out.set(srcBuffer.subarray(srcOff, srcOff + PAYLOAD_SIZE), dstOff);
    out.set(srcBuffer.subarray(srcOff + 0xFF0, srcOff + 0x1000), dstOff + 0xFF0);

    wu16(out, dstOff + 0xFF4, sid);
    wu32(out, dstOff + 0xFFC, targetIdx);

    if (OPAQUE_IDS.has(sid)) {
        wu16(out, dstOff + 0xFF6, srcSection.checksum);
    } else {
        recalcStandardChecksum(out, dstOff);
    }
}

function applyManifestBytes(out, dstSection, changes, sid) {
    const dstOff = dstSection.off;
    for (const change of changes) {
        out[dstOff + Number(change.rel_off)] = Number(change.to) & 0xFF;
    }
    if (!OPAQUE_IDS.has(sid)) {
        recalcStandardChecksum(out, dstOff);
    }
}

function verifyCandidate(buffer, fixed) {
    const fixedLatest = latestById(fixed);
    const candLatest = latestById(buffer);
    const targetIdx = Math.max(...Object.values(fixedLatest)
        .filter((section) => section.id >= 0 && section.id < 14)
        .map((section) => section.save_idx));

    const issues = [];
    for (let sid = 0; sid < 14; sid += 1) {
        if (!candLatest[sid] || !fixedLatest[sid]) {
            issues.push(`missing sid=${sid}`);
            continue;
        }
        const candidate = candLatest[sid];
        const fixedSection = fixedLatest[sid];

        if (candidate.save_idx !== targetIdx) {
            issues.push(`sid=${sid} wrong idx ${candidate.save_idx} != ${targetIdx}`);
        }
        if (candidate.off !== fixedSection.off) {
            issues.push(`sid=${sid} wrong off ${candidate.off} != ${fixedSection.off}`);
        }
        if (!OPAQUE_IDS.has(sid)) {
            const validLen = ru32(buffer, candidate.off + 0xFF0);
            const checksumLen = (validLen === 0 || validLen > 0xFF4) ? 0xFF4 : validLen;
            const calculated = gbaChecksum(buffer, candidate.off, checksumLen);
            const stored = ru16(buffer, candidate.off + 0xFF6);
            if (calculated !== stored) {
                issues.push(`sid=${sid} checksum mismatch ${stored} != ${calculated}`);
            }
        }
    }
    return issues;
}

function computeLayoutOffsetForSaveIdx(sectionId, saveIdx) {
    const baseBlock = (saveIdx % 2 === 0) ? 0 : 14;
    const rel = (sectionId + (saveIdx % 14)) % 14;
    return (baseBlock + rel) * SECTION_SIZE;
}

function coherentSaveGenerations(buffer) {
    const generations = [];
    for (const firstBlock of [0, 14]) {
        const sections = [];
        for (let block = firstBlock; block < firstBlock + 14; block += 1) {
            const off = block * SECTION_SIZE;
            sections.push({
                sid: ru16(buffer, off + 0xFF4),
                signature: ru32(buffer, off + 0xFF8),
                saveIdx: ru32(buffer, off + 0xFFC),
                off,
            });
        }

        const saveIndices = new Set(sections.map((section) => section.saveIdx));
        const sectionIds = new Set(sections.map((section) => section.sid));
        if (saveIndices.size !== 1 || sectionIds.size !== 14) continue;
        if (![...Array(14).keys()].every((sid) => sectionIds.has(sid))) continue;

        const saveIdx = sections[0].saveIdx;
        if (saveIdx === 0 || saveIdx === 0xFFFFFFFF) continue;
        if (sections.some((section) => section.signature !== UNBOUND_SECTION_SIGNATURE)) continue;
        if (sections.some((section) => section.off !== computeLayoutOffsetForSaveIdx(section.sid, saveIdx))) continue;

        generations.push({
            saveIdx,
            sections: Object.fromEntries(sections.map((section) => [section.sid, section.off])),
        });
    }
    return generations;
}

export function reenableTimeFixer(saveBytes) {
    const source = saveBytes instanceof Uint8Array ? saveBytes : new Uint8Array(saveBytes);
    if (source.length !== SAVE_BODY_LEN && source.length !== SAVE_WITH_TRAILER_LEN) {
        throw new Error(
            `Unsupported save size: ${source.length} bytes. Expected ${SAVE_BODY_LEN} or ${SAVE_WITH_TRAILER_LEN}.`,
        );
    }

    const generations = coherentSaveGenerations(source).sort((a, b) => b.saveIdx - a.saveIdx);
    if (!generations.length) {
        throw new Error('No coherent Pokemon Unbound save generation was found');
    }
    if (generations.length > 1 && generations[0].saveIdx === generations[1].saveIdx) {
        throw new Error('Active save generation is ambiguous');
    }

    const active = generations[0];
    const sectionOffset = active.sections[TIME_FIXER_SECTION_ID];
    const absoluteOffset = sectionOffset + TIME_FIXER_REL_OFF;
    const before = source[absoluteOffset];
    if ((before & TIME_FIXER_USED_MASK) === 0) {
        throw new Error('The in-game Time Fixer is already available in the active save generation');
    }

    const output = new Uint8Array(source);
    const after = before & (~TIME_FIXER_USED_MASK & 0xFF);
    output[absoluteOffset] = after;

    const changed = [];
    for (let idx = 0; idx < source.length; idx += 1) {
        if (source[idx] !== output[idx]) changed.push(idx);
    }
    if (changed.length !== 1 || changed[0] !== absoluteOffset) {
        throw new Error('Time Fixer reset must change exactly one byte');
    }
    for (let idx = sectionOffset + 0xFF0; idx < sectionOffset + 0x1000; idx += 1) {
        if (source[idx] !== output[idx]) throw new Error('Time Fixer reset must preserve the section footer');
    }
    for (let idx = SAVE_BODY_LEN; idx < source.length; idx += 1) {
        if (source[idx] !== output[idx]) throw new Error('Time Fixer reset must preserve the RTC trailer');
    }

    return {
        bytes: output,
        save_idx: active.saveIdx,
        section_offset: sectionOffset,
        absolute_offset: absoluteOffset,
        before,
        after,
        changed_bytes: 1,
    };
}

export function buildManifest(brokenBytes, fixedBytes) {
    const brokenById = sectionsById(brokenBytes);
    const fixedById = sectionsById(fixedBytes);
    const commonIds = Object.keys(brokenById)
        .map(Number)
        .filter((sid) => Object.prototype.hasOwnProperty.call(fixedById, sid))
        .sort((a, b) => a - b);

    const changesById = {};
    for (const sid of commonIds) {
        const brokenSection = brokenById[sid][0];
        const fixedSection = fixedById[sid][0];
        const changes = [];

        for (let rel = 0; rel < PAYLOAD_SIZE; rel += 1) {
            const from = brokenBytes[brokenSection.off + rel];
            const to = fixedBytes[fixedSection.off + rel];
            if (from !== to) {
                changes.push({ rel_off: rel, from, to });
            }
        }

        if (changes.length > 0) {
            changesById[String(sid)] = {
                sid,
                broken_latest: {
                    save_idx: brokenSection.save_idx,
                    off: brokenSection.off,
                    checksum: ru16(brokenBytes, brokenSection.off + 0xFF6),
                },
                fixed_latest: {
                    save_idx: fixedSection.save_idx,
                    off: fixedSection.off,
                    checksum: ru16(fixedBytes, fixedSection.off + 0xFF6),
                },
                count: changes.length,
                changes,
            };
        }
    }

    const rtcCoreIds = [0];
    const rtcAuxIds = Object.keys(changesById)
        .map(Number)
        .sort((a, b) => a - b)
        .filter((sid) => !rtcCoreIds.includes(sid));

    return {
        format: 1,
        notes: 'Derived from broken vs NPC-fixed save. Apply carefully by section id/relative offsets.',
        changes_by_id: changesById,
        profiles: {
            core_only: rtcCoreIds,
            core_plus_aux: [...rtcCoreIds, ...rtcAuxIds],
        },
    };
}

export function buildCandidateFromPair(broken, fixed, manifest, profile) {
    const out = new Uint8Array(broken);
    const brokenLatest = latestById(broken);
    const fixedLatest = latestById(fixed);

    const targetIdx = Math.max(...Object.values(fixedLatest)
        .filter((section) => section.id >= 0 && section.id < 14)
        .map((section) => section.save_idx));

    const sectionSource = {};
    for (let sid = 0; sid < 14; sid += 1) {
        sectionSource[sid] = 'broken';
    }
    let patchIds = [];

    if (profile === 'control') {
        // no-op
    } else if (profile === 'id0_full') {
        sectionSource[0] = 'fixed';
    } else if (profile === 'id0_id13_full') {
        sectionSource[0] = 'fixed';
        sectionSource[13] = 'fixed';
    } else if (profile === 'id0_id4_full') {
        sectionSource[0] = 'fixed';
        sectionSource[4] = 'fixed';
    } else if (profile === 'id0_id4_id13_full') {
        sectionSource[0] = 'fixed';
        sectionSource[4] = 'fixed';
        sectionSource[13] = 'fixed';
    } else if (profile === 'id0_full_plus_aux12') {
        sectionSource[0] = 'fixed';
        patchIds = [1, 2];
    } else if (profile === 'id0_id4_id13_full_plus_aux12') {
        sectionSource[0] = 'fixed';
        sectionSource[4] = 'fixed';
        sectionSource[13] = 'fixed';
        patchIds = [1, 2];
    } else {
        throw new Error(`Unknown profile: ${profile}`);
    }

    for (let sid = 0; sid < 14; sid += 1) {
        const dst = fixedLatest[sid];
        const src = sectionSource[sid] === 'broken' ? brokenLatest[sid] : fixedLatest[sid];
        const srcBuffer = sectionSource[sid] === 'broken' ? broken : fixed;
        writeSectionFromSource(out, dst, srcBuffer, src, sid, targetIdx);
    }

    for (const sid of patchIds) {
        const changes = manifest?.changes_by_id?.[String(sid)]?.changes || [];
        if (changes.length > 0) {
            applyManifestBytes(out, fixedLatest[sid], changes, sid);
        }
    }

    return out;
}

export function buildCandidatesFromPair(broken, fixed, manifest, profiles = DEFAULT_PROFILES) {
    const out = {};
    for (const profile of profiles) {
        const candidate = buildCandidateFromPair(broken, fixed, manifest, profile);
        out[profile] = {
            bytes: candidate,
            issues: verifyCandidate(candidate, fixed),
        };
    }
    return out;
}

export function buildQuickCandidatesFromSingle(tampered, manifest) {
    const srcLatest = latestById(tampered);
    const sourceIdx = Math.max(...Array.from({ length: 14 }, (_, sid) => srcLatest[sid].save_idx));
    const targetIdx = sourceIdx + 1;

    const base = new Uint8Array(tampered);
    const dstSections = {};

    for (let sid = 0; sid < 14; sid += 1) {
        const src = srcLatest[sid];
        if (!src) {
            throw new Error(`Missing source section id=${sid}`);
        }

        const srcOff = src.off;
        const dstOff = computeLayoutOffsetForSaveIdx(sid, targetIdx);

        base.set(tampered.subarray(srcOff, srcOff + PAYLOAD_SIZE), dstOff);
        base.set(tampered.subarray(srcOff + 0xFF0, srcOff + 0x1000), dstOff + 0xFF0);
        wu16(base, dstOff + 0xFF4, sid);
        wu32(base, dstOff + 0xFFC, targetIdx);

        if (OPAQUE_IDS.has(sid)) {
            wu16(base, dstOff + 0xFF6, src.checksum);
        } else {
            recalcStandardChecksum(base, dstOff);
        }

        dstSections[sid] = {
            off: dstOff,
            id: sid,
            save_idx: targetIdx,
            valid_len: ru32(base, dstOff + 0xFF0),
        };
    }

    const candidates = {};
    for (const [name, ids] of Object.entries(QUICK_PROFILES)) {
        const candidate = new Uint8Array(base);
        for (const sid of ids) {
            const changes = manifest?.changes_by_id?.[String(sid)]?.changes || [];
            const dstOff = dstSections[sid].off;

            for (const entry of changes) {
                candidate[dstOff + Number(entry.rel_off)] = Number(entry.to) & 0xFF;
            }

            if (!OPAQUE_IDS.has(sid)) {
                recalcStandardChecksum(candidate, dstOff);
            } else {
                const fixedChecksum = manifest?.changes_by_id?.[String(sid)]?.fixed_latest?.checksum;
                wu16(candidate, dstOff + 0xFF6, fixedChecksum ?? srcLatest[sid].checksum);
            }
        }
        candidates[name] = candidate;
    }

    return {
        source_idx: sourceIdx,
        target_idx: targetIdx,
        candidates,
    };
}

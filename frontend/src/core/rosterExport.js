import { calcCurrentLevel } from './growth.js';
import { NATURES } from './showdownImport.js';
import { calculateBattleStats } from './statCalc.js';
import { buildGameProgressSnapshot } from './gameProgress.js';
import { classifyKnownEggMoves } from './unboundLearnset.js';
import { calculateHiddenPowerType } from './hiddenPower.js';
import { buildSpeedTierRosterContext } from './unboundSpeedTiers.js';
import { findRosterLevelCapViolations } from './levelCap.js';
import { getEvolutionExportInfo } from './evolutionMeta.js';
import { formatAbilityDisplayName } from './abilityDisplay.js';
import { formatSpeciesTypeLine } from './speciesTypeFormat.js';

export const ROSTER_EXPORT_BOX_IDS = [...Array.from({ length: 25 }, (_, idx) => idx + 1), 26];

function normalizeSpeedStat(stats = {}) {
    const next = { ...stats };
    if (next.Spd !== undefined && next.Spe === undefined) {
        next.Spe = next.Spd;
        delete next.Spd;
    }
    return next;
}

function lookupName(map, id, fallback = '') {
    const key = Number(id);
    if (!Number.isFinite(key) || key <= 0) {
        return fallback;
    }
    return map.get(key) || fallback;
}

function resolveLevel(mon) {
    if (Number.isFinite(mon.level) && mon.level > 0) {
        return mon.level;
    }
    if (Number.isFinite(mon.exp) && Number.isFinite(mon.species_growth_rate)) {
        return calcCurrentLevel(mon.species_growth_rate, mon.exp);
    }
    return null;
}

function resolveNature(mon) {
    return mon.nature || NATURES[mon.nature_id] || 'Unknown';
}

function resolveNatureId(mon) {
    if (Number.isFinite(mon.nature_id)) {
        return mon.nature_id;
    }
    const natureName = resolveNature(mon);
    const idx = NATURES.findIndex((name) => name === natureName);
    return idx >= 0 ? idx : 0;
}

function buildMoveNames(mon, moveNameById) {
    return (mon.moves || [])
        .map((moveId) => {
            const id = Number(moveId);
            if (!Number.isFinite(id) || id <= 0) {
                return null;
            }
            return lookupName(moveNameById, id, `Move ${id}`);
        })
        .filter(Boolean);
}

export function createCatalogLookups({ items = [], moves = [] }) {
    return {
        itemNameById: new Map(items.map((row) => [Number(row.id), row.name])),
        moveNameById: new Map(moves.map((row) => [Number(row.id), row.name])),
    };
}

export function buildRosterEntry(mon, catalogs) {
    const { itemNameById, moveNameById } = catalogs;
    const speciesName = mon.species_label || mon.species_name || mon.species_display_name || `Species ${mon.species_id}`;
    const itemId = Number(mon.item_id || 0);
    const level = resolveLevel(mon);
    const ivs = normalizeSpeedStat(mon.ivs || {});
    const evs = normalizeSpeedStat(mon.evs || {});
    const friendship = Number.isFinite(mon.friendship) ? mon.friendship : null;
    const currentAbility = formatAbilityDisplayName(
        mon.ability_name_current || mon.ability_label_current || '',
    );
    const evolution = getEvolutionExportInfo(mon.species_id, {
        currentAbilityName: currentAbility,
        currentAbilityIndex: mon.current_ability_index,
    });

    return {
        nickname: mon.nickname || '',
        species_name: speciesName,
        species_id: mon.species_id,
        type_line: formatSpeciesTypeLine(mon.species_id),
        level,
        nature: resolveNature(mon),
        ability: currentAbility,
        is_hidden_ability: Boolean(mon.is_hidden_ability || mon.current_ability_index === 2),
        gender: mon.gender || null,
        item_name: itemId > 0 ? lookupName(itemNameById, itemId, `Item ${itemId}`) : null,
        stats: calculateBattleStats({
            speciesId: mon.species_id,
            level,
            natureId: resolveNatureId(mon),
            ivs,
            evs,
        }),
        ivs,
        evs,
        moves: buildMoveNames(mon, moveNameById),
        friendship,
        hidden_power_type: calculateHiddenPowerType(ivs),
        egg_moves: classifyKnownEggMoves(mon, moveNameById),
        evolution_tag: evolution?.tag ?? null,
        final_species_name: evolution?.final_species_name ?? null,
        final_bst: evolution?.final_bst ?? null,
        stage_index: evolution?.stage_index ?? null,
        stage_total: evolution?.stage_total ?? null,
        evos_remaining: evolution?.evos_remaining ?? null,
        evo_requirements: evolution?.evo_requirements ?? null,
    };
}

function attachGameProgress(payload, buffer, catalogs, capProfile, gameProgressOverride = null) {
    const gameProgress = gameProgressOverride
        ?? (buffer ? buildGameProgressSnapshot(buffer, { ...catalogs, capProfile }) : null);
    if (!gameProgress) {
        return payload;
    }
    return {
        ...payload,
        game_progress: gameProgress,
        speed_tier_context: buildSpeedTierRosterContext({
            party: payload.party || [],
            gameProgress,
        }),
        level_cap_violations: findRosterLevelCapViolations({
            party: payload.party || [],
            pc: payload.pc || [],
            gameProgress,
        }),
    };
}

export function buildPartyPayload({
    party = [],
    catalogs,
    sourceFileName = null,
    buffer = null,
    capProfile = null,
    gameProgress = null,
}) {
    return attachGameProgress({
        exported_at: new Date().toISOString(),
        source: 'PUSE',
        source_file: sourceFileName,
        party: party.map((mon) => buildRosterEntry(mon, catalogs)),
    }, buffer, catalogs, capProfile, gameProgress);
}

export function buildRosterPayload({
    party = [],
    pc = [],
    catalogs,
    sourceFileName = null,
    buffer = null,
    capProfile = null,
    gameProgress = null,
    exportMode = null,
}) {
    const normalizedParty = party.map((mon) => buildRosterEntry(mon, catalogs));
    const normalizedPc = pc.map(({ box, slot, mon }) => ({
        box,
        slot,
        ...buildRosterEntry(mon, catalogs),
    }));

    const basePayload = {
        exported_at: new Date().toISOString(),
        source: 'PUSE',
        source_file: sourceFileName,
        export_mode: exportMode,
        summary: {
            party: normalizedParty.length,
            pc: normalizedPc.length,
            total: normalizedParty.length + normalizedPc.length,
        },
        party: normalizedParty,
        pc: normalizedPc,
    };

    return attachGameProgress(basePayload, buffer, catalogs, capProfile, gameProgress);
}

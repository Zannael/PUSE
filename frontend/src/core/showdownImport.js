import speciesAbilitiesMeta from './speciesAbilitiesMeta.json' with { type: 'json' };
import abilitiesCatalog from './abilitiesCatalog.json' with { type: 'json' };

export const NATURES = [
    'Hardy', 'Lonely', 'Brave', 'Adamant', 'Naughty',
    'Bold', 'Docile', 'Relaxed', 'Impish', 'Lax',
    'Timid', 'Hasty', 'Serious', 'Jolly', 'Naive',
    'Modest', 'Mild', 'Quiet', 'Bashful', 'Rash',
    'Calm', 'Gentle', 'Sassy', 'Careful', 'Quirky',
];

const IV_STAT_MAX = 31;
const EV_STAT_MAX = 252;
const EV_TOTAL_MAX = 510;
const MIN_LEVEL = 1;
const MAX_LEVEL = 100;

export const normalizeName = (value) =>
    String(value || '')
        .toLowerCase()
        .replace(/[’']/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

export const clampLevel = (value, fallback = 5) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, parsed));
};

const parseSetStatToken = (rawToken) => {
    const token = String(rawToken || '').replace(/[^A-Za-z]/g, '');
    const lower = token.toLowerCase();
    if (token === 'HP' || lower === 'hp') return 'HP';
    if (token === 'Atk' || lower === 'atk' || lower === 'attack') return 'Atk';
    if (token === 'Def' || lower === 'def' || lower === 'defense') return 'Def';
    if (token === 'SpA' || lower === 'spa' || lower === 'spatk' || lower === 'specialattack' || lower === 'specialatk') return 'SpA';
    if (token === 'SpD' || lower === 'spd' || lower === 'spdef' || lower === 'specialdefense' || lower === 'specialdef') return 'SpD';
    if (token === 'Spe' || token === 'Spd' || lower === 'spe' || lower === 'speed') return 'Spe';
    return null;
};

export const parseShowdownSet = (rawText) => {
    const text = String(rawText || '').replace(/\r/g, '');
    const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
    const parsed = {
        nickname: '',
        speciesName: '',
        itemName: '',
        abilityName: '',
        natureName: '',
        level: null,
        shiny: null,
        evs: null,
        ivs: null,
        moves: [],
        warnings: [],
    };
    const errors = [];

    if (lines.length === 0) {
        errors.push('Set text is empty.');
        return { parsed, errors };
    }

    const header = lines[0];
    const atIndex = header.indexOf('@');
    const headerLeft = atIndex >= 0 ? header.slice(0, atIndex).trim() : header.trim();
    if (atIndex >= 0) {
        parsed.itemName = header.slice(atIndex + 1).trim();
    }

    const nickSpeciesMatch = headerLeft.match(/^(.*?)\(([^)]+)\)\s*$/);
    if (nickSpeciesMatch) {
        parsed.nickname = nickSpeciesMatch[1].trim();
        parsed.speciesName = nickSpeciesMatch[2].trim();
    } else {
        parsed.speciesName = headerLeft;
    }

    if (!parsed.speciesName) {
        errors.push('Could not parse species from first line.');
    }

    lines.slice(1).forEach((line) => {
        if (line.startsWith('Ability:')) {
            parsed.abilityName = line.slice('Ability:'.length).trim();
            return;
        }
        if (line.startsWith('EVs:')) {
            const evs = { HP: 0, Atk: 0, Def: 0, SpA: 0, SpD: 0, Spe: 0 };
            line.slice('EVs:'.length).split('/').forEach((chunk) => {
                const m = chunk.trim().match(/^(\d+)\s+(.+)$/);
                if (!m) return;
                const statKey = parseSetStatToken(m[2]);
                if (!statKey) return;
                evs[statKey] = Number.parseInt(m[1], 10);
            });
            parsed.evs = evs;
            return;
        }
        if (line.startsWith('IVs:')) {
            const ivs = { HP: IV_STAT_MAX, Atk: IV_STAT_MAX, Def: IV_STAT_MAX, SpA: IV_STAT_MAX, SpD: IV_STAT_MAX, Spe: IV_STAT_MAX };
            line.slice('IVs:'.length).split('/').forEach((chunk) => {
                const m = chunk.trim().match(/^(\d+)\s+(.+)$/);
                if (!m) return;
                const statKey = parseSetStatToken(m[2]);
                if (!statKey) return;
                ivs[statKey] = Number.parseInt(m[1], 10);
            });
            parsed.ivs = ivs;
            return;
        }
        if (line.startsWith('Level:')) {
            const n = Number.parseInt(line.slice('Level:'.length).trim(), 10);
            if (Number.isFinite(n)) parsed.level = n;
            return;
        }
        if (line.startsWith('Shiny:')) {
            parsed.shiny = normalizeName(line.slice('Shiny:'.length)) === 'yes';
            return;
        }
        if (line.endsWith(' Nature')) {
            parsed.natureName = line.replace(/\s+Nature$/, '').trim();
            return;
        }
        if (line.startsWith('-')) {
            const moveName = line.replace(/^-+\s*/, '').trim();
            if (moveName) parsed.moves.push(moveName);
            return;
        }
        if (line.startsWith('Tera Type:')) {
            parsed.warnings.push('Tera Type is ignored in this save format.');
            return;
        }
        parsed.warnings.push(`Ignored line: ${line}`);
    });

    if (parsed.moves.length > 4) {
        parsed.warnings.push(`Only first 4 moves are used (received ${parsed.moves.length}).`);
        parsed.moves = parsed.moves.slice(0, 4);
    }

    return { parsed, errors };
};

const buildLookup = (rows, namesForRow) => {
    const byNorm = new Map();
    rows.forEach((row) => {
        namesForRow(row).forEach((name) => {
            const norm = normalizeName(name);
            if (!norm) return;
            if (!byNorm.has(norm)) byNorm.set(norm, new Map());
            byNorm.get(norm).set(Number(row.id), row);
        });
    });
    return byNorm;
};

const resolveSpeciesAbilityData = (speciesId) => {
    const meta = speciesAbilitiesMeta?.[String(speciesId)] || {};
    const ability1Id = Number(meta.ability_1_id || 0);
    const ability2Id = Number(meta.ability_2_id || 0);
    const hiddenId = Number(meta.hidden_ability_id || 0);
    return {
        ability_1_id: ability1Id,
        ability_1_name: ability1Id ? abilitiesCatalog[String(ability1Id)] || `Ability ${ability1Id}` : '',
        ability_2_id: ability2Id,
        ability_2_name: ability2Id ? abilitiesCatalog[String(ability2Id)] || `Ability ${ability2Id}` : '',
        ability_hidden_id: hiddenId,
        ability_hidden_name: hiddenId ? abilitiesCatalog[String(hiddenId)] || `Ability ${hiddenId}` : '',
    };
};

const getCandidates = (lookup, inputName) => {
    if (!inputName) return [];
    const norm = normalizeName(inputName);
    return Array.from((lookup.get(norm) || new Map()).values());
};

const REGIONAL_SUFFIX_TO_ADJECTIVE = {
    alola: 'alolan',
    galar: 'galarian',
    hisui: 'hisuian',
};

const getSpeciesLabel = (row) =>
    String(row?.label || row?.display_name || row?.name || '').trim();

const getSpeciesBaseName = (row) =>
    String(row?.display_name || row?.name || row?.label || '').trim();

const parseRegionalInput = (speciesInput) => {
    const raw = String(speciesInput || '').trim();
    const m = raw.match(/^(.*?)[\s-](Alola|Galar|Hisui)$/i);
    if (!m) return null;
    const base = String(m[1] || '').trim();
    const region = String(m[2] || '').toLowerCase();
    const adjective = REGIONAL_SUFFIX_TO_ADJECTIVE[region];
    if (!base || !adjective) return null;
    return { base, region, adjective };
};

const scoreSpeciesCandidate = (row) => {
    const labelNorm = normalizeName(getSpeciesLabel(row));
    let score = 0;

    if (labelNorm.includes('form 1')) score -= 50;
    if (labelNorm.includes('standard mode')) score -= 45;
    if (labelNorm.includes('normal forme')) score -= 20;

    if (labelNorm.includes('form 2') || labelNorm.includes('form 3')) score += 20;

    [
        'zen mode',
        'blade forme',
        'ash',
        'school form',
        'gigantamax',
        'mega',
        'primal',
        'attack forme',
        'defense forme',
        'speed forme',
    ].forEach((token) => {
        if (labelNorm.includes(token)) score += 30;
    });

    return score;
};

const pickDefaultSpecies = (candidates) => {
    const sorted = [...candidates].sort((a, b) => {
        const scoreDiff = scoreSpeciesCandidate(a) - scoreSpeciesCandidate(b);
        if (scoreDiff !== 0) return scoreDiff;
        return Number(a.id) - Number(b.id);
    });
    return sorted[0] || null;
};

const resolveSpeciesRow = ({ speciesInput, speciesLookup, speciesRows, warnings, blocking }) => {
    if (!speciesInput) {
        blocking.push('Could not parse species from first line.');
        return null;
    }

    const exactCandidates = getCandidates(speciesLookup, speciesInput);
    if (exactCandidates.length === 1) {
        return exactCandidates[0];
    }
    if (exactCandidates.length > 1) {
        const chosen = pickDefaultSpecies(exactCandidates);
        const ids = exactCandidates.map((s) => Number(s.id)).sort((a, b) => a - b).join(', ');
        warnings.push(`Species ${speciesInput} matched multiple forms (${ids}); using default form ${chosen?.id}.`);
        return chosen;
    }

    const regional = parseRegionalInput(speciesInput);
    if (!regional) {
        blocking.push(`Species not found in Unbound catalogs: ${speciesInput}`);
        return null;
    }

    const baseNorm = normalizeName(regional.base);
    const baseCandidates = (speciesRows || []).filter((row) => normalizeName(getSpeciesBaseName(row)) === baseNorm);
    if (baseCandidates.length === 0) {
        blocking.push(`Species not found in Unbound catalogs: ${speciesInput}`);
        return null;
    }

    const regionalCandidates = baseCandidates.filter((row) =>
        normalizeName(getSpeciesLabel(row)).includes(regional.adjective)
    );
    if (regionalCandidates.length === 0) {
        blocking.push(`Regional form not found for ${speciesInput} in Unbound catalogs.`);
        return null;
    }

    const chosen = pickDefaultSpecies(regionalCandidates);
    warnings.push(`Resolved ${speciesInput} -> ${getSpeciesLabel(chosen)}.`);
    return chosen;
};

export const resolveShowdownSet = ({ parsed, catalogs, legitMode = false, levelFallback = 5 }) => {
    const blocking = [];
    const warnings = [...(parsed?.warnings || [])];
    const species = catalogs?.species || [];
    const items = catalogs?.items || [];
    const moves = catalogs?.moves || [];
    const abilities = catalogs?.abilities || [];

    const speciesLookup = buildLookup(species, (s) => [s.label, s.display_name, s.name, String(s.id)]);
    const itemLookup = buildLookup(items, (i) => [i.name, String(i.id)]);
    const moveLookup = buildLookup(moves, (m) => [m.name, String(m.id)]);
    const abilityLookup = buildLookup(abilities, (a) => [a.name, String(a.id)]);

    const pickOne = (lookup, inputName, kind) => {
        if (!inputName) return null;
        const candidates = getCandidates(lookup, inputName);
        if (candidates.length === 0) {
            blocking.push(`${kind} not found in Unbound catalogs: ${inputName}`);
            return null;
        }
        if (candidates.length > 1) {
            blocking.push(`${kind} is ambiguous: ${inputName}`);
            return null;
        }
        return candidates[0];
    };

    const speciesRow = resolveSpeciesRow({
        speciesInput: parsed.speciesName,
        speciesLookup,
        speciesRows: species,
        warnings,
        blocking,
    });

    let itemRow = null;
    if (parsed.itemName) {
        const itemCandidates = getCandidates(itemLookup, parsed.itemName);
        if (itemCandidates.length === 0) {
            blocking.push(`Item not found in Unbound catalogs: ${parsed.itemName}`);
        } else if (itemCandidates.length === 1) {
            itemRow = itemCandidates[0];
        } else {
            itemCandidates.sort((a, b) => Number(a.id) - Number(b.id));
            itemRow = itemCandidates[0];
            const ids = itemCandidates.map((it) => Number(it.id)).join(', ');
            warnings.push(`Item ${parsed.itemName} matched multiple IDs (${ids}); using lowest ID ${itemRow.id}.`);
        }
    }

    const abilityRow = parsed.abilityName ? pickOne(abilityLookup, parsed.abilityName, 'Ability') : null;
    const moveRows = [];
    (parsed.moves || []).forEach((name) => {
        const moveRow = pickOne(moveLookup, name, 'Move');
        if (moveRow) moveRows.push(moveRow);
    });

    let abilityIndex = null;
    let speciesAbilityData = null;
    if (speciesRow) {
        speciesAbilityData = resolveSpeciesAbilityData(speciesRow.id);
    }
    if (abilityRow && speciesAbilityData) {
        const wanted = normalizeName(abilityRow.name);
        if (normalizeName(speciesAbilityData.ability_1_name) === wanted) abilityIndex = 0;
        else if (normalizeName(speciesAbilityData.ability_2_name) === wanted) abilityIndex = 1;
        else if (normalizeName(speciesAbilityData.ability_hidden_name) === wanted) abilityIndex = 2;
        else blocking.push(`Ability ${abilityRow.name} is not available for ${speciesRow.label || speciesRow.name}.`);
    }

    let natureId = null;
    if (parsed.natureName) {
        const idx = NATURES.findIndex((name) => normalizeName(name) === normalizeName(parsed.natureName));
        if (idx < 0) blocking.push(`Nature not found: ${parsed.natureName}`);
        else natureId = idx;
    }

    if (parsed.evs) {
        const vals = Object.values(parsed.evs).map((x) => Number(x || 0));
        if (vals.some((x) => x < 0 || x > EV_STAT_MAX)) {
            blocking.push('EVs must stay in range 0..252 per stat.');
        }
        const total = vals.reduce((a, b) => a + b, 0);
        if (legitMode && total > EV_TOTAL_MAX) {
            blocking.push(`Legit mode is ON: EV total ${total} exceeds 510.`);
        }
    }

    if (parsed.ivs) {
        const vals = Object.values(parsed.ivs).map((x) => Number(x || 0));
        if (vals.some((x) => x < 0 || x > IV_STAT_MAX)) {
            blocking.push('IVs must stay in range 0..31 per stat.');
        }
    }

    let levelToApply = null;
    if (parsed.level !== null && Number.isFinite(parsed.level)) {
        levelToApply = clampLevel(parsed.level, levelFallback);
        if (levelToApply !== parsed.level) {
            warnings.push(`Level ${parsed.level} was clamped to ${levelToApply}.`);
        }
    }

    return {
        errors: blocking,
        warnings,
        resolved: {
            speciesRow,
            itemRow,
            abilityIndex,
            speciesAbilityData,
            moveRows,
            natureId,
            levelToApply,
            parsed,
        },
    };
};

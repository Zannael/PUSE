function yesNo(value) {
    return value ? 'yes' : 'no';
}

function formatMoney(amount) {
    const value = Number(amount);
    if (!Number.isFinite(value)) {
        return '—';
    }
    return `$${value.toLocaleString('en-US')}`;
}

function formatStatLine(stats) {
    if (!stats) {
        return null;
    }
    return `HP ${stats.HP}, Atk ${stats.Atk}, Def ${stats.Def}, SpA ${stats.SpA}, SpD ${stats.SpD}, Spe ${stats.Spe}`;
}

function formatIvEvLine(ivs = {}, evs = {}, { suppressZeroEvs = false } = {}) {
    const order = ['HP', 'Atk', 'Def', 'SpA', 'SpD', 'Spe'];
    const ivPart = order.map((key) => ivs[key] ?? 0).join('/');
    const evValues = order.map((key) => evs[key] ?? 0);
    const evTotal = evValues.reduce((sum, value) => sum + Number(value || 0), 0);
    const evPart = suppressZeroEvs && evTotal === 0 ? '—' : evValues.join('/');
    return `IVs ${ivPart} · EVs ${evPart}`;
}

function monTitle(mon) {
    const nickname = String(mon.nickname || '').trim();
    const base = nickname ? `${mon.species_name} (${nickname})` : mon.species_name;
    if (mon.evolution_tag) {
        return `${base} ${mon.evolution_tag}`;
    }
    return base;
}

function formatMonDetailed(mon) {
    const lines = [`### ${monTitle(mon)}`];
    const identity = [
        mon.type_line,
        mon.level != null ? `Lv ${mon.level}` : null,
        mon.nature,
        mon.ability ? `${mon.ability}${mon.is_hidden_ability ? ' (H)' : ''}` : null,
        mon.gender,
        mon.item_name ? mon.item_name : null,
    ].filter(Boolean);
    if (identity.length) {
        lines.push(`- ${identity.join(' · ')}`);
    }

    const statLine = formatStatLine(mon.stats);
    if (statLine) {
        lines.push(`- **Stats:** ${statLine}`);
    }
    lines.push(`- **${formatIvEvLine(mon.ivs, mon.evs)}**`);

    if (Array.isArray(mon.moves) && mon.moves.length) {
        lines.push(`- **Moves:** ${mon.moves.join(', ')}`);
    }

    const extras = [];
    if (Number.isFinite(mon.friendship)) {
        extras.push(`Friendship ${mon.friendship}`);
    }
    if (mon.hidden_power_type) {
        extras.push(`Hidden Power ${mon.hidden_power_type}`);
    }
    if (extras.length) {
        lines.push(`- ${extras.join(' · ')}`);
    }

    if (Array.isArray(mon.egg_moves) && mon.egg_moves.length) {
        lines.push(`- **Egg moves in set:** ${mon.egg_moves.join(', ')}`);
    }

    return lines.join('\n');
}

function formatMonCompact(mon, { box, slot } = {}) {
    const prefix = box != null && slot != null ? `Box ${box} · ${slot}: ` : '';
    const identity = [
        mon.type_line,
        mon.level != null ? `Lv ${mon.level}` : null,
        mon.nature,
        mon.ability ? `${mon.ability}${mon.is_hidden_ability ? ' (H)' : ''}` : null,
        mon.item_name || null,
    ].filter(Boolean).join(' · ');
    const moves = Array.isArray(mon.moves) && mon.moves.length ? mon.moves.join(' / ') : '—';
    const ivEv = formatIvEvLine(mon.ivs, mon.evs, { suppressZeroEvs: true });
    return `- **${prefix}${monTitle(mon)}** — ${identity} — ${ivEv} — ${moves}`;
}

function formatGameProgressSection(gameProgress) {
    if (!gameProgress) {
        return '';
    }

    const keyItems = gameProgress.key_items || {};
    const consumables = gameProgress.consumables || {};
    const lines = [
        '## Game Progress',
        `- **Badges:** ${gameProgress.badge_count ?? '—'} · **Level cap:** ${gameProgress.normal_level_cap ?? gameProgress.active_level_cap ?? '—'} (normal) / ${gameProgress.expert_level_cap ?? '—'} (expert) · **Check:** ${gameProgress.cap_profile ?? 'normal'} ${gameProgress.effective_level_cap ?? '—'} · **Champion:** ${yesNo(gameProgress.is_champion)}`,
        `- **Money:** ${formatMoney(gameProgress.money)} · **BP:** ${gameProgress.battle_points ?? '—'}`,
        `- **Key items:** DexNav ${yesNo(keyItems.dexnav)}, Stat Scanner ${yesNo(keyItems.stat_scanner)}, Mega Ring ${yesNo(keyItems.mega_ring)}`,
        `- **Consumables:** Heart Scale ×${consumables.heart_scale ?? 0}, Dream Mist ×${consumables.dream_mist ?? 0}, Bottle Cap ×${consumables.bottle_cap ?? 0}, Gold Bottle Cap ×${consumables.gold_bottle_cap ?? 0}`,
        '',
    ];
    return lines.join('\n');
}

function formatLevelCapSection(gameProgress, violations = []) {
    if (!gameProgress || gameProgress.is_champion) {
        return '';
    }
    if (!Array.isArray(violations) || violations.length === 0) {
        return [
            '## Level Cap Check',
            `_No Pokémon exceed the ${gameProgress.cap_profile ?? 'normal'} cap (${gameProgress.effective_level_cap ?? '—'})._`,
            '',
        ].join('\n');
    }

    const lines = [
        '## Level Cap Check',
        `_Legit profile: **${gameProgress.cap_profile ?? 'normal'}** · effective cap **${gameProgress.effective_level_cap ?? '—'}**._`,
        '',
    ];

    violations.forEach((entry) => {
        const title = entry.nickname
            ? `${entry.species_name} (${entry.nickname})`
            : entry.species_name;
        lines.push(
            `- **${title}** (${entry.location}) — Lv ${entry.level} exceeds cap by ${entry.over_by}`,
        );
    });

    lines.push('');
    return lines.join('\n');
}

function formatSpeedTierSection(speedTierContext) {
    if (!speedTierContext) {
        return '';
    }

    if (speedTierContext.champion) {
        return [
            '## Expert Speed Tiers',
            '_Champion save: no active expert cap milestone. Reference table omitted._',
            '',
        ].join('\n');
    }

    const { milestone, party_checks: checks = [], normal_level_cap: normalCap } = speedTierContext;
    if (!milestone) {
        return '';
    }

    const lines = [
        '## Expert Speed Tiers',
        `_Expert-mode reference from trainers doc. Normal save level cap: ${normalCap ?? '—'}._`,
        '',
        `### Upcoming: ${milestone.boss_name} (expert cap ${milestone.level_cap})`,
        '',
    ];

    if (!checks.length) {
        // No detailed speed-tier rows for this boss yet (e.g. a milestone added to the
        // boss list before the trainers workbook was regenerated). Show known threats by name.
        const names = Array.isArray(milestone.threats) ? milestone.threats : [];
        lines.push(
            names.length
                ? `- Key threats: ${names.join(', ')}`
                : '- Speed-tier reference data for this fight is not available yet.',
        );
        if (names.length) {
            lines.push('- _Detailed speed benchmarks for this fight are not available yet._');
        }
        lines.push('');
        return lines.join('\n');
    }

    checks.forEach(({ threat, outspeeders }) => {
        const mechanics = Array.isArray(threat.threat_mechanics)
            ? threat.threat_mechanics.join(', ')
            : threat.threat_mechanics;
        const partyLine = outspeeders?.length
            ? outspeeders.join(', ')
            : '—';
        lines.push(
            `- **${threat.threat}** — outspeed **${threat.required_roster_speed}** Spe`
            + ` (cap benchmark ${threat.cap_benchmark_speed}, boss Lv ${threat.boss_level}`
            + `${mechanics && mechanics !== 'None' ? `, ${mechanics}` : ''})`
            + ` — party: ${partyLine}`,
        );
    });

    lines.push('');
    return lines.join('\n');
}

function formatHeader(payload) {
    const exportedAt = payload.exported_at
        ? new Date(payload.exported_at).toLocaleString()
        : new Date().toLocaleString();
    const sourceFile = payload.source_file || 'unknown save';
    const lines = [
        '# Pokémon Unbound Roster',
        '',
        `Exported ${exportedAt} · Source: \`${sourceFile}\` · PUSE`,
    ];
    if (payload.export_mode === 'selection' && payload.summary) {
        lines.push(
            `_Selection export: ${payload.summary.total} Pokémon`
            + ` (${payload.summary.party} party · ${payload.summary.pc} PC)_`,
        );
    }
    lines.push('');
    return lines.join('\n');
}

export function rosterPayloadToMarkdown(payload) {
    if (!payload || typeof payload !== 'object') {
        return '';
    }

    const lines = [
        formatHeader(payload),
        formatGameProgressSection(payload.game_progress),
        formatLevelCapSection(payload.game_progress, payload.level_cap_violations),
        formatSpeedTierSection(payload.speed_tier_context),
    ];

    const party = Array.isArray(payload.party) ? payload.party : [];
    if (party.length) {
        lines.push('## Party', '');
        party.forEach((mon, index) => {
            lines.push(formatMonDetailed(mon));
            if (index < party.length - 1) {
                lines.push('');
            }
        });
    }

    const pc = Array.isArray(payload.pc) ? payload.pc : [];
    const selectionExport = payload.export_mode === 'selection';
    if (pc.length) {
        lines.push('', selectionExport ? '## Selected PC' : '## PC', '');
        if (payload.summary && !selectionExport) {
            lines.push(`_${payload.summary.party} party · ${payload.summary.pc} PC · ${payload.summary.total} total Pokémon · empty PC slots omitted_`, '');
        }

        if (selectionExport) {
            pc.forEach((entry, index) => {
                lines.push(formatMonDetailed(entry));
                if (index < pc.length - 1) {
                    lines.push('');
                }
            });
        } else {
            const byBox = new Map();
            pc.forEach((entry) => {
                const box = Number(entry.box);
                const bucket = byBox.get(box) || [];
                bucket.push(entry);
                byBox.set(box, bucket);
            });

            [...byBox.keys()].sort((a, b) => a - b).forEach((boxId) => {
                lines.push(`### Box ${boxId}`, '');
                byBox.get(boxId)
                    .sort((a, b) => Number(a.slot) - Number(b.slot))
                    .forEach((entry) => {
                        lines.push(formatMonCompact(entry, { box: entry.box, slot: entry.slot }));
                    });
                lines.push('');
            });
        }
    }

    return `${lines.join('\n').trim()}\n`;
}

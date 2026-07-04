import React, { useEffect, useMemo, useState } from 'react';
import { ExternalLink, BookOpen } from 'lucide-react';
import { buildUnboundDexSpeciesUrl, resolveDexSpeciesLabel } from '../core/unboundDex.js';
import {
    formatLearnsetBucket,
    getSpeciesDexSummary,
    validatePokemonLegitSet,
} from '../core/unboundLearnset.js';
import {
    buildDexMoveDeepLink,
    buildDexProgressPayload,
    buildDexProgressSummaryLines,
    formatLearnsetBucketWithProgress,
    LEARNSET_BUCKETS,
    MOVE_AVAILABILITY,
} from '../core/dexProgress.js';
import { getMoveToTmhmItemIds } from '../core/tmhmCatalog.js';
import PokedexFlagsControls from './PokedexFlagsControls.jsx';

function TypePill({ type }) {
    if (!type) {
        return null;
    }
    return (
        <span className="px-2 py-0.5 rounded-md bg-slate-800 border border-white/10 text-[10px] font-bold uppercase tracking-wide text-slate-200">
            {type}
        </span>
    );
}

function availabilityClassName(status) {
    switch (status) {
    case MOVE_AVAILABILITY.TM_MISSING:
        return 'text-amber-200';
    case MOVE_AVAILABILITY.TM_CASE_LOCKED:
        return 'text-rose-200';
    case MOVE_AVAILABILITY.TUTOR_UNKNOWN:
        return 'text-slate-400';
    default:
        return 'text-slate-300';
    }
}

function LearnsetSection({ title, moveIds, moveNameById, bucket, dexProgress, moveToItemIds, note }) {
    if (!Array.isArray(moveIds) || moveIds.length === 0) {
        return null;
    }

    const formatted = dexProgress && moveToItemIds
        ? formatLearnsetBucketWithProgress({
            moveIds,
            moveNameById,
            bucket,
            dexProgress,
            moveToItemIds,
        })
        : {
            entries: moveIds.map((id) => ({
                id: Number(id),
                name: moveNameById?.get?.(Number(id)) || `Move ${id}`,
                status: MOVE_AVAILABILITY.UNKNOWN,
                hint: null,
                label: moveNameById?.get?.(Number(id)) || `Move ${id}`,
            })),
            text: formatLearnsetBucket(moveIds, moveNameById),
            missingTmCount: 0,
            lockedTmCount: 0,
        };

    return (
        <div className="space-y-1">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{title}</p>
            {note && (
                <p className="text-[10px] text-slate-500">{note}</p>
            )}
            <p className="text-[11px] leading-relaxed">
                {formatted.entries.slice(0, 12).map((entry, index) => (
                    <React.Fragment key={`${entry.id}-${index}`}>
                        {index > 0 ? ', ' : ''}
                        <a
                            href={buildDexMoveDeepLink(entry.name)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`hover:underline ${availabilityClassName(entry.status)}`}
                            title={entry.hint || entry.name}
                        >
                            {entry.label}
                        </a>
                    </React.Fragment>
                ))}
                {formatted.entries.length > 12 && (
                    <span className="text-slate-500">{`, +${formatted.entries.length - 12} more`}</span>
                )}
            </p>
            {formatted.missingTmCount > 0 && (
                <p className="text-[10px] text-amber-200/90">
                    {formatted.missingTmCount} TM/HM move{formatted.missingTmCount === 1 ? '' : 's'} not in your bag.
                </p>
            )}
        </div>
    );
}

export default function UnboundDexPanel({
    speciesRow,
    speciesId,
    pokemon,
    moveNameById,
    legitMode = false,
    gameProgress = null,
    client = null,
}) {
    const speciesLabel = resolveDexSpeciesLabel(speciesRow, `Species ${speciesId}`);
    const dexUrl = buildUnboundDexSpeciesUrl(speciesLabel);
    const summary = useMemo(() => getSpeciesDexSummary(speciesId), [speciesId]);
    const dexProgress = useMemo(() => buildDexProgressPayload(gameProgress), [gameProgress]);
    const progressLines = useMemo(
        () => buildDexProgressSummaryLines(dexProgress),
        [dexProgress],
    );
    const [moveToItemIds, setMoveToItemIds] = useState(null);
    const canLoadTmCatalog = Boolean(
        dexProgress && moveNameById instanceof Map && moveNameById.size > 0,
    );

    useEffect(() => {
        if (!canLoadTmCatalog) {
            return undefined;
        }
        let cancelled = false;
        getMoveToTmhmItemIds(moveNameById)
            .then((map) => {
                if (!cancelled) {
                    setMoveToItemIds(map);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setMoveToItemIds(null);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [canLoadTmCatalog, moveNameById]);

    const resolvedMoveToItemIds = canLoadTmCatalog ? moveToItemIds : null;

    const legitCheck = useMemo(() => {
        if (!legitMode || !pokemon) {
            return null;
        }
        const moveMap = moveNameById instanceof Map ? moveNameById : new Map();
        return validatePokemonLegitSet({
            speciesId,
            moves: pokemon.moves || [],
            currentAbilityIndex: pokemon.current_ability_index,
            abilityNames: {
                current: pokemon.ability_label_current,
                currentId: pokemon.current_ability_index === 2
                    ? pokemon.ability_hidden_id
                    : pokemon.current_ability_index === 1
                        ? pokemon.ability_2_id
                        : pokemon.ability_1_id,
            },
            moveNameById: moveMap,
        });
    }, [legitMode, pokemon, speciesId, moveNameById]);

    const bst = summary.stats
        ? summary.stats.hp + summary.stats.atk + summary.stats.def + summary.stats.spa + summary.stats.spd + summary.stats.spe
        : null;

    return (
        <div className="space-y-4">
            {client && (
                <PokedexFlagsControls
                    client={client}
                    speciesId={speciesId}
                    speciesLabel={speciesLabel}
                />
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-slate-300">
                    <BookOpen size={16} className="text-violet-300" />
                    <h4 className="text-sm font-bold">Unbound Dex</h4>
                </div>
                <a
                    href={dexUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-violet-600/80 hover:bg-violet-500 text-[10px] font-bold uppercase tracking-widest text-white transition-colors"
                >
                    Open full entry
                    <ExternalLink size={12} />
                </a>
            </div>

            {progressLines.length > 0 && (
                <div className="rounded-xl border border-violet-500/20 bg-violet-500/10 px-3 py-2 text-[11px] text-violet-100 space-y-1">
                    {progressLines.map((line) => (
                        <p key={line}>{line}</p>
                    ))}
                    <p className="text-[10px] text-violet-200/80">
                        TM/HM hints use your bag. Tutor gates are not tracked in save data yet.
                    </p>
                </div>
            )}

            <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-violet-200">{speciesLabel}</span>
                    {(summary.types?.types || []).map((type) => (
                        <TypePill key={type} type={type} />
                    ))}
                </div>

                {summary.stats && (
                    <p className="text-[11px] text-slate-400">
                        Base stats: HP {summary.stats.hp}, Atk {summary.stats.atk}, Def {summary.stats.def}, SpA {summary.stats.spa}, SpD {summary.stats.spd}, Spe {summary.stats.spe}
                        {bst != null ? ` · BST ${bst}` : ''}
                    </p>
                )}

                {!summary.learnsetLoaded && (
                    <p className="text-[11px] text-amber-200/90">
                        Learnset data is not bundled yet. Run <span className="font-mono">python backend/tools/sync_unbound_dex_learnsets.py</span> to generate it.
                    </p>
                )}

                {summary.learnset && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                        <LearnsetSection
                            title="Level-up"
                            moveIds={summary.learnset.level_up}
                            moveNameById={moveNameById}
                            bucket={LEARNSET_BUCKETS.LEVEL_UP}
                            dexProgress={dexProgress}
                            moveToItemIds={resolvedMoveToItemIds}
                            note={dexProgress && !dexProgress.is_champion
                                ? `Level-up legality also depends on the ${dexProgress.cap_profile} cap (${dexProgress.effective_level_cap}).`
                                : null}
                        />
                        <LearnsetSection
                            title="TM / HM"
                            moveIds={summary.learnset.tmhm}
                            moveNameById={moveNameById}
                            bucket={LEARNSET_BUCKETS.TMHM}
                            dexProgress={dexProgress}
                            moveToItemIds={resolvedMoveToItemIds}
                        />
                        <LearnsetSection
                            title="Tutor"
                            moveIds={summary.learnset.tutor}
                            moveNameById={moveNameById}
                            bucket={LEARNSET_BUCKETS.TUTOR}
                            dexProgress={dexProgress}
                            moveToItemIds={resolvedMoveToItemIds}
                            note="Tutor availability depends on story progress; open a move link for Dex locations."
                        />
                        <LearnsetSection
                            title="Egg"
                            moveIds={summary.learnset.egg}
                            moveNameById={moveNameById}
                            bucket={LEARNSET_BUCKETS.EGG}
                            dexProgress={dexProgress}
                            moveToItemIds={resolvedMoveToItemIds}
                        />
                    </div>
                )}
            </div>

            {legitCheck && (legitCheck.issues.length > 0 || legitCheck.warnings.length > 0) && (
                <div className="space-y-2">
                    {legitCheck.issues.length > 0 && (
                        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200 space-y-1">
                            <p className="font-bold uppercase tracking-widest text-[10px]">Legit mode issues</p>
                            {legitCheck.issues.map((msg) => (
                                <p key={msg}>- {msg}</p>
                            ))}
                        </div>
                    )}
                    {legitCheck.warnings.length > 0 && (
                        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200 space-y-1">
                            {legitCheck.warnings.map((msg) => (
                                <p key={msg}>- {msg}</p>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {legitMode && legitCheck && legitCheck.issues.length === 0 && legitCheck.warnings.length === 0 && (
                <p className="text-[11px] text-emerald-300">
                    Current moves and ability pass Unbound learnset checks.
                </p>
            )}
        </div>
    );
}

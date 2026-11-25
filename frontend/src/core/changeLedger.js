import { buildSaveReport } from './saveHealth.js';

export const DEFAULT_MAX_ENTRIES = 50;

function buffersEqual(a, b) {
    if (!a || !b || a.length !== b.length) {
        return false;
    }
    for (let i = 0; i < a.length; i += 1) {
        if (a[i] !== b[i]) {
            return false;
        }
    }
    return true;
}

function countByteDiffs(a, b) {
    if (!a && !b) return 0;
    const left = a || new Uint8Array(0);
    const right = b || new Uint8Array(0);
    const minLen = Math.min(left.length, right.length);
    let diff = Math.abs(left.length - right.length);
    for (let i = 0; i < minLen; i += 1) {
        if (left[i] !== right[i]) {
            diff += 1;
        }
    }
    return diff;
}

function computeRuns(beforeBytes, afterBytes) {
    const minLen = Math.min(beforeBytes.length, afterBytes.length);
    const runs = [];
    let changed = 0;
    let i = 0;
    while (i < minLen) {
        if (beforeBytes[i] === afterBytes[i]) {
            i += 1;
            continue;
        }
        const start = i;
        while (i < minLen && beforeBytes[i] !== afterBytes[i]) {
            i += 1;
        }
        const chunk = beforeBytes.slice(start, i);
        runs.push({ offset: start, beforeBytes: chunk });
        changed += chunk.length;
    }

    let tailBefore = new Uint8Array(0);
    if (beforeBytes.length > afterBytes.length) {
        tailBefore = beforeBytes.slice(afterBytes.length);
        changed += tailBefore.length;
    } else if (afterBytes.length > beforeBytes.length) {
        changed += afterBytes.length - beforeBytes.length;
    }

    return {
        runs,
        beforeLen: beforeBytes.length,
        tailBefore,
        changedBytes: changed,
    };
}

function extractRegions(beforeBytes, afterBytes, changedBytes) {
    const report = buildSaveReport(beforeBytes, afterBytes, false);
    const regions = [];
    const seen = new Set();
    for (const sector of report.changes.sectors) {
        for (const field of sector.fields) {
            if (!seen.has(field.name)) {
                seen.add(field.name);
                regions.push(field.name);
            }
        }
    }
    if (regions.length === 0 && changedBytes > 0) {
        regions.push('Save footer');
    }
    return regions;
}

function toEntrySummary(entry) {
    return {
        id: entry.id,
        kind: entry.kind,
        label: entry.label,
        changed_bytes: entry.changedBytes,
        regions: [...entry.regions],
    };
}

export class ChangeLedger {
    constructor(maxEntries = DEFAULT_MAX_ENTRIES) {
        const cap = Number(maxEntries);
        if (!Number.isInteger(cap) || cap <= 0) {
            throw new Error('maxEntries must be positive');
        }
        this.maxEntries = cap;
        this.entries = [];
        this.nextId = 1;
        this.lastSavedEntryId = 0;
        this.evictedBagDirty = false;
        this.group = null;
    }

    clear() {
        this.entries = [];
        this.nextId = 1;
        this.lastSavedEntryId = 0;
        this.evictedBagDirty = false;
        this.group = null;
    }

    hasActiveGroup() {
        return this.group !== null;
    }

    beginGroup(currentData, kind = 'edit', label = 'Edit save') {
        if (this.group !== null) {
            throw new Error('A change group is already active');
        }
        this.group = {
            kind: String(kind || 'edit'),
            label: String(label || 'Edit save'),
            baseline: new Uint8Array(currentData),
        };
    }

    commitGroup(currentData) {
        if (this.group === null) {
            throw new Error('No active change group');
        }
        const activeGroup = this.group;
        this.group = null;
        return this.#pushDiff(
            activeGroup.baseline,
            new Uint8Array(currentData),
            activeGroup.kind,
            activeGroup.label,
        );
    }

    abortGroup() {
        if (this.group === null) {
            return null;
        }
        const baseline = this.group.baseline;
        this.group = null;
        return new Uint8Array(baseline);
    }

    record(beforeBytes, afterBytes, kind = 'edit', label = 'Edit save') {
        if (this.group !== null) {
            return null;
        }
        return this.#pushDiff(
            new Uint8Array(beforeBytes),
            new Uint8Array(afterBytes),
            String(kind || 'edit'),
            String(label || 'Edit save'),
        );
    }

    #pushDiff(beforeBytes, afterBytes, kind, label) {
        if (buffersEqual(beforeBytes, afterBytes)) {
            return null;
        }
        const { runs, beforeLen, tailBefore, changedBytes } = computeRuns(beforeBytes, afterBytes);
        if (changedBytes === 0) {
            return null;
        }
        const regions = extractRegions(beforeBytes, afterBytes, changedBytes);
        const entry = {
            id: this.nextId,
            kind,
            label,
            runs,
            beforeLen,
            tailBefore,
            changedBytes,
            regions,
        };
        this.nextId += 1;
        this.entries.push(entry);
        while (this.entries.length > this.maxEntries) {
            const dropped = this.entries.shift();
            if (dropped.id > this.lastSavedEntryId && dropped.kind === 'bag_edit') {
                this.evictedBagDirty = true;
            }
        }
        return toEntrySummary(entry);
    }

    undo(currentData) {
        if (this.group !== null) {
            throw new Error('Cannot undo while a change group is active');
        }
        if (this.entries.length === 0) {
            throw new Error('Nothing to undo');
        }
        const entry = this.entries.pop();
        let next;
        if (currentData.length === entry.beforeLen) {
            next = new Uint8Array(currentData);
        } else {
            next = new Uint8Array(entry.beforeLen);
            next.set(currentData.subarray(0, Math.min(currentData.length, entry.beforeLen)));
        }
        for (const run of entry.runs) {
            next.set(run.beforeBytes, run.offset);
        }
        if (entry.tailBefore.length > 0) {
            next.set(entry.tailBefore, entry.beforeLen - entry.tailBefore.length);
        }
        return {
            undone: toEntrySummary(entry),
            buffer: next,
        };
    }

    reset(originalData) {
        this.entries = [];
        this.group = null;
        this.lastSavedEntryId = 0;
        this.evictedBagDirty = false;
        return new Uint8Array(originalData);
    }

    markSaved() {
        this.lastSavedEntryId = this.entries.length > 0 ? this.entries[this.entries.length - 1].id : 0;
        this.evictedBagDirty = false;
    }

    hasUncommittedBagChanges() {
        if (this.evictedBagDirty) {
            return true;
        }
        return this.entries.some((entry) => entry.id > this.lastSavedEntryId && entry.kind === 'bag_edit');
    }

    summary(currentData, originalData) {
        const totalChangedBytes = countByteDiffs(originalData, currentData);
        return {
            entries: [...this.entries].reverse().map(toEntrySummary),
            can_undo: this.entries.length > 0,
            can_reset: Boolean(currentData && (totalChangedBytes > 0 || this.entries.length > 0)),
            total_changed_bytes: totalChangedBytes,
            max_entries: this.maxEntries,
        };
    }
}

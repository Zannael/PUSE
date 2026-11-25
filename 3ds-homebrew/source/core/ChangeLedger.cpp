#include <puse/core/ChangeLedger.hpp>

#include <puse/core/SaveHealth.hpp>

#include <algorithm>

namespace puse::core {

namespace {

size_t ComputeRuns(const std::vector<uint8_t>& before_bytes,
                   const std::vector<uint8_t>& after_bytes,
                   std::vector<LedgerRun>& runs,
                   std::vector<uint8_t>& tail_before) {
    runs.clear();
    tail_before.clear();

    const size_t min_len = std::min(before_bytes.size(), after_bytes.size());
    size_t changed = 0;
    size_t i = 0;
    while (i < min_len) {
        if (before_bytes[i] == after_bytes[i]) {
            ++i;
            continue;
        }
        const size_t start = i;
        while (i < min_len && before_bytes[i] != after_bytes[i]) {
            ++i;
        }
        LedgerRun run;
        run.offset = start;
        run.before_bytes.assign(before_bytes.begin() + static_cast<ptrdiff_t>(start),
                                before_bytes.begin() + static_cast<ptrdiff_t>(i));
        changed += run.before_bytes.size();
        runs.push_back(std::move(run));
    }

    if (before_bytes.size() > after_bytes.size()) {
        tail_before.assign(before_bytes.begin() + static_cast<ptrdiff_t>(after_bytes.size()),
                           before_bytes.end());
        changed += tail_before.size();
    } else if (after_bytes.size() > before_bytes.size()) {
        changed += after_bytes.size() - before_bytes.size();
    }
    return changed;
}

size_t CountByteDiffs(const std::vector<uint8_t>& a, const std::vector<uint8_t>& b) {
    if (a == b) {
        return 0;
    }
    const size_t min_len = std::min(a.size(), b.size());
    size_t diff = 0;
    for (size_t i = 0; i < min_len; ++i) {
        if (a[i] != b[i]) {
            ++diff;
        }
    }
    return diff + (a.size() > b.size() ? a.size() - b.size() : b.size() - a.size());
}

std::vector<std::string> ExtractRegions(const std::vector<uint8_t>& before_bytes,
                                        const std::vector<uint8_t>& after_bytes,
                                        size_t changed_bytes) {
    const SaveHealthReport report = BuildSaveHealthReport(before_bytes, after_bytes);
    std::vector<std::string> regions;
    for (const auto& sector : report.sectors) {
        for (const auto& field : sector.fields) {
            if (std::find(regions.begin(), regions.end(), field.name) == regions.end()) {
                regions.push_back(field.name);
            }
        }
    }
    if (regions.empty() && changed_bytes > 0) {
        regions.emplace_back("Save footer");
    }
    return regions;
}

} // namespace

ChangeLedger::ChangeLedger(size_t max_entries)
    : max_entries_(max_entries == 0 ? 1 : max_entries) {}

void ChangeLedger::Clear() {
    entries_.clear();
    next_id_ = 1;
    last_saved_entry_id_ = 0;
    evicted_bag_dirty_ = false;
    saved_diverged_ = false;
    has_active_group_ = false;
    group_ = ActiveGroup{};
}

bool ChangeLedger::HasActiveGroup() const {
    return has_active_group_;
}

bool ChangeLedger::BeginGroup(const std::vector<uint8_t>& current_data,
                              const std::string& kind,
                              const std::string& label,
                              std::string* error) {
    if (has_active_group_) {
        if (error) {
            *error = "A change group is already active";
        }
        return false;
    }
    has_active_group_ = true;
    group_.kind = kind.empty() ? "edit" : kind;
    group_.label = label.empty() ? "Edit save" : label;
    group_.baseline = current_data;
    return true;
}

bool ChangeLedger::CommitGroup(const std::vector<uint8_t>& current_data,
                               bool* out_recorded,
                               LedgerEntrySummary* out_entry,
                               std::string* error) {
    if (!has_active_group_) {
        if (error) {
            *error = "No active change group";
        }
        return false;
    }
    ActiveGroup active = std::move(group_);
    group_ = ActiveGroup{};
    has_active_group_ = false;

    const bool recorded = PushDiff(active.baseline, current_data, active.kind, active.label, out_entry);
    if (out_recorded) {
        *out_recorded = recorded;
    }
    return true;
}

bool ChangeLedger::AbortGroup(std::vector<uint8_t>& current_data) {
    if (!has_active_group_) {
        return false;
    }
    current_data = std::move(group_.baseline);
    group_ = ActiveGroup{};
    has_active_group_ = false;
    return true;
}

bool ChangeLedger::Record(const std::vector<uint8_t>& before_bytes,
                          const std::vector<uint8_t>& after_bytes,
                          const std::string& kind,
                          const std::string& label,
                          LedgerEntrySummary* out_entry) {
    if (has_active_group_) {
        return false;
    }
    return PushDiff(before_bytes,
                    after_bytes,
                    kind.empty() ? "edit" : kind,
                    label.empty() ? "Edit save" : label,
                    out_entry);
}

LedgerEntrySummary ChangeLedger::ToSummary(const Entry& entry) {
    LedgerEntrySummary summary;
    summary.id = entry.id;
    summary.kind = entry.kind;
    summary.label = entry.label;
    summary.changed_bytes = entry.changed_bytes;
    summary.regions = entry.regions;
    return summary;
}

bool ChangeLedger::PushDiff(const std::vector<uint8_t>& before_bytes,
                            const std::vector<uint8_t>& after_bytes,
                            const std::string& kind,
                            const std::string& label,
                            LedgerEntrySummary* out_entry) {
    if (before_bytes == after_bytes) {
        return false;
    }
    Entry entry;
    entry.changed_bytes = ComputeRuns(before_bytes, after_bytes, entry.runs, entry.tail_before);
    if (entry.changed_bytes == 0) {
        return false;
    }
    entry.id = next_id_++;
    entry.kind = kind;
    entry.label = label;
    entry.before_len = before_bytes.size();
    entry.regions = ExtractRegions(before_bytes, after_bytes, entry.changed_bytes);

    if (out_entry) {
        *out_entry = ToSummary(entry);
    }
    entries_.push_back(std::move(entry));
    while (entries_.size() > max_entries_) {
        const Entry dropped = std::move(entries_.front());
        entries_.erase(entries_.begin());
        if (dropped.id == last_saved_entry_id_) {
            saved_diverged_ = true;
        }
        if (dropped.id > last_saved_entry_id_ && dropped.kind == "bag_edit") {
            evicted_bag_dirty_ = true;
        }
    }
    return true;
}

bool ChangeLedger::Undo(std::vector<uint8_t>& current_data,
                        LedgerEntrySummary* out_undone,
                        std::string* error) {
    if (has_active_group_) {
        if (error) {
            *error = "Cannot undo while a change group is active";
        }
        return false;
    }
    if (entries_.empty()) {
        if (error) {
            *error = "Nothing to undo";
        }
        return false;
    }
    Entry entry = std::move(entries_.back());
    entries_.pop_back();

    if (entry.id <= last_saved_entry_id_) {
        saved_diverged_ = true;
        last_saved_entry_id_ = 0;
    }

    current_data.resize(entry.before_len);
    for (const auto& run : entry.runs) {
        std::copy(run.before_bytes.begin(),
                  run.before_bytes.end(),
                  current_data.begin() + static_cast<ptrdiff_t>(run.offset));
    }
    if (!entry.tail_before.empty()) {
        const size_t tail_start = entry.before_len - entry.tail_before.size();
        std::copy(entry.tail_before.begin(),
                  entry.tail_before.end(),
                  current_data.begin() + static_cast<ptrdiff_t>(tail_start));
    }
    if (out_undone) {
        *out_undone = ToSummary(entry);
    }
    return true;
}

void ChangeLedger::Reset(std::vector<uint8_t>& current_data, const std::vector<uint8_t>& original_data) {
    if (last_saved_entry_id_ > 0) {
        saved_diverged_ = true;
    }
    entries_.clear();
    has_active_group_ = false;
    group_ = ActiveGroup{};
    last_saved_entry_id_ = 0;
    evicted_bag_dirty_ = false;
    current_data = original_data;
}

void ChangeLedger::MarkSaved() {
    last_saved_entry_id_ = entries_.empty() ? 0 : entries_.back().id;
    evicted_bag_dirty_ = false;
    saved_diverged_ = false;
}

bool ChangeLedger::HasUncommittedBagChanges() const {
    if (evicted_bag_dirty_) {
        return true;
    }
    for (const auto& entry : entries_) {
        if (entry.id > last_saved_entry_id_ && entry.kind == "bag_edit") {
            return true;
        }
    }
    return false;
}

bool ChangeLedger::HasUnsavedChanges() const {
    if (saved_diverged_) {
        return true;
    }
    const uint64_t head_id = entries_.empty() ? 0 : entries_.back().id;
    return head_id != last_saved_entry_id_;
}

size_t ChangeLedger::EntryCount() const {
    return entries_.size();
}

size_t ChangeLedger::MaxEntries() const {
    return max_entries_;
}

LedgerSummary ChangeLedger::Summary(const std::vector<uint8_t>& current_data,
                                 const std::vector<uint8_t>& original_data) const {
    LedgerSummary summary;
    summary.max_entries = max_entries_;
    summary.total_changed_bytes = CountByteDiffs(original_data, current_data);
    summary.can_undo = !entries_.empty();
    summary.can_reset = summary.total_changed_bytes > 0 || !entries_.empty();
    summary.entries.reserve(entries_.size());
    for (auto it = entries_.rbegin(); it != entries_.rend(); ++it) {
        summary.entries.push_back(ToSummary(*it));
    }
    return summary;
}

} // namespace puse::core

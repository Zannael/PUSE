#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace puse::core {

constexpr size_t kDefaultMaxLedgerEntries = 50;

struct LedgerRun {
    size_t offset = 0;
    std::vector<uint8_t> before_bytes;
};

struct LedgerEntrySummary {
    uint64_t id = 0;
    std::string kind;
    std::string label;
    size_t changed_bytes = 0;
    std::vector<std::string> regions;
};

struct LedgerSummary {
    std::vector<LedgerEntrySummary> entries;
    bool can_undo = false;
    bool can_reset = false;
    size_t total_changed_bytes = 0;
    size_t max_entries = kDefaultMaxLedgerEntries;
};

class ChangeLedger {
  public:
    explicit ChangeLedger(size_t max_entries = kDefaultMaxLedgerEntries);

    void Clear();
    bool HasActiveGroup() const;

    bool BeginGroup(const std::vector<uint8_t>& current_data,
                    const std::string& kind,
                    const std::string& label,
                    std::string* error = nullptr);
    bool CommitGroup(const std::vector<uint8_t>& current_data,
                     bool* out_recorded = nullptr,
                     LedgerEntrySummary* out_entry = nullptr,
                     std::string* error = nullptr);
    bool AbortGroup(std::vector<uint8_t>& current_data);

    bool Record(const std::vector<uint8_t>& before_bytes,
                const std::vector<uint8_t>& after_bytes,
                const std::string& kind,
                const std::string& label,
                LedgerEntrySummary* out_entry = nullptr);

    bool Undo(std::vector<uint8_t>& current_data,
              LedgerEntrySummary* out_undone = nullptr,
              std::string* error = nullptr);
    void Reset(std::vector<uint8_t>& current_data, const std::vector<uint8_t>& original_data);

    void MarkSaved();
    bool HasUncommittedBagChanges() const;
    bool HasUnsavedChanges() const;
    size_t EntryCount() const;
    size_t MaxEntries() const;

    LedgerSummary Summary(const std::vector<uint8_t>& current_data,
                          const std::vector<uint8_t>& original_data) const;

  private:
    struct Entry {
        uint64_t id = 0;
        std::string kind;
        std::string label;
        std::vector<LedgerRun> runs;
        size_t before_len = 0;
        std::vector<uint8_t> tail_before;
        size_t changed_bytes = 0;
        std::vector<std::string> regions;
    };

    struct ActiveGroup {
        std::string kind;
        std::string label;
        std::vector<uint8_t> baseline;
    };

    static LedgerEntrySummary ToSummary(const Entry& entry);
    bool PushDiff(const std::vector<uint8_t>& before_bytes,
                  const std::vector<uint8_t>& after_bytes,
                  const std::string& kind,
                  const std::string& label,
                  LedgerEntrySummary* out_entry);

    size_t max_entries_ = kDefaultMaxLedgerEntries;
    std::vector<Entry> entries_;
    uint64_t next_id_ = 1;
    uint64_t last_saved_entry_id_ = 0;
    bool evicted_bag_dirty_ = false;
    bool saved_diverged_ = false;
    bool has_active_group_ = false;
    ActiveGroup group_;
};

} // namespace puse::core

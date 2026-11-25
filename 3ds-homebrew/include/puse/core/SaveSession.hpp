#pragma once

#include <string>
#include <vector>

#include <puse/core/ChangeLedger.hpp>
#include <puse/core/SaveSections.hpp>

namespace puse::core {

class SaveSession {
  public:
    bool LoadFromFile(const std::string &path, std::string *error = nullptr, const std::string& profile_id = "");
    bool ExportToFile(const std::string &path, std::string *error = nullptr) const;

    void Clear();

    bool IsLoaded() const;
    const profile::GameProfile* Profile() const;
    const std::string &SourcePath() const;
    std::string FileName() const;

    const std::vector<uint8_t> &Buffer() const;
    const std::vector<uint8_t> &OriginalBuffer() const;
    std::vector<uint8_t> &MutableBuffer();
    std::vector<SaveSection> Sections() const;

    bool RecordMutation(const std::vector<uint8_t> &before_bytes,
                        const std::string &kind,
                        const std::string &label,
                        LedgerEntrySummary *out_entry = nullptr);
    bool BeginHistoryGroup(const std::string &kind,
                           const std::string &label,
                           std::string *error = nullptr);
    bool CommitHistoryGroup(bool *out_recorded = nullptr,
                            LedgerEntrySummary *out_entry = nullptr,
                            std::string *error = nullptr);
    bool AbortHistoryGroup();
    bool UndoLastChange(LedgerEntrySummary *out_undone = nullptr, std::string *error = nullptr);
    void ResetToOriginal();
    void MarkSaved();

    bool HasUnsavedChanges() const;
    bool HasUncommittedBagChanges() const;
    bool CanUndo() const;
    bool CanReset() const;
    size_t TotalChangedBytes() const;
    LedgerSummary History() const;
    const ChangeLedger &Ledger() const;

  private:
    const profile::GameProfile* profile_ = nullptr;
    std::vector<uint8_t> buffer_;
    std::vector<uint8_t> original_buffer_;
    std::string source_path_;
    ChangeLedger ledger_;
};

} // namespace puse::core

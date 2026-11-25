#include <puse/core/SaveSession.hpp>

#include <fstream>

namespace puse::core {

bool SaveSession::LoadFromFile(const std::string &path, std::string *error, const std::string& profile_id) {
    std::ifstream in(path, std::ios::binary);
    if (!in.good()) {
        if (error != nullptr) {
            *error = "failed to open input file";
        }
        return false;
    }

    in.seekg(0, std::ios::end);
    const auto size = in.tellg();
    if (size <= 0) {
        if (error != nullptr) {
            *error = "input file is empty";
        }
        return false;
    }
    in.seekg(0, std::ios::beg);

    std::vector<uint8_t> next(static_cast<size_t>(size));
    in.read(reinterpret_cast<char *>(next.data()), static_cast<std::streamsize>(next.size()));
    if (!in.good() && !in.eof()) {
        if (error != nullptr) {
            *error = "failed to read file bytes";
        }
        return false;
    }

    const profile::GameProfile* chosen=nullptr;
    if(!ChooseProfile(next,profile_id,&chosen,error))return false;
    profile::SelectProfile(chosen->id);
    profile_ = chosen;
    buffer_ = std::move(next);
    original_buffer_ = buffer_;
    source_path_ = path;
    ledger_.Clear();
    return true;
}

bool SaveSession::ExportToFile(const std::string &path, std::string *error) const {
    if (buffer_.empty()) {
        if (error != nullptr) {
            *error = "session is empty";
        }
        return false;
    }

    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    if (!out.good()) {
        if (error != nullptr) {
            *error = "failed to open output file";
        }
        return false;
    }

    out.write(reinterpret_cast<const char *>(buffer_.data()), static_cast<std::streamsize>(buffer_.size()));
    if (!out.good()) {
        if (error != nullptr) {
            *error = "failed to write output file";
        }
        return false;
    }
    return true;
}

void SaveSession::Clear() {
    profile_ = nullptr;
    buffer_.clear();
    original_buffer_.clear();
    source_path_.clear();
    ledger_.Clear();
}

bool SaveSession::IsLoaded() const {
    return !buffer_.empty();
}

const std::string &SaveSession::SourcePath() const {
    return source_path_;
}

std::string SaveSession::FileName() const {
    if (source_path_.empty()) {
        return "";
    }
    const auto pos = source_path_.find_last_of("/\\");
    if (pos == std::string::npos) {
        return source_path_;
    }
    return source_path_.substr(pos + 1);
}

const std::vector<uint8_t> &SaveSession::Buffer() const {
    return buffer_;
}

const std::vector<uint8_t> &SaveSession::OriginalBuffer() const {
    return original_buffer_;
}

std::vector<uint8_t> &SaveSession::MutableBuffer() {
    return buffer_;
}

std::vector<SaveSection> SaveSession::Sections() const {
    return ListSections(buffer_);
}

bool SaveSession::RecordMutation(const std::vector<uint8_t> &before_bytes,
                                 const std::string &kind,
                                 const std::string &label,
                                 LedgerEntrySummary *out_entry) {
    if (!IsLoaded()) {
        return false;
    }
    return ledger_.Record(before_bytes, buffer_, kind, label, out_entry);
}

bool SaveSession::BeginHistoryGroup(const std::string &kind,
                                    const std::string &label,
                                    std::string *error) {
    if (!IsLoaded()) {
        if (error) {
            *error = "session is empty";
        }
        return false;
    }
    return ledger_.BeginGroup(buffer_, kind, label, error);
}

bool SaveSession::CommitHistoryGroup(bool *out_recorded,
                                     LedgerEntrySummary *out_entry,
                                     std::string *error) {
    if (!IsLoaded()) {
        if (error) {
            *error = "session is empty";
        }
        return false;
    }
    return ledger_.CommitGroup(buffer_, out_recorded, out_entry, error);
}

bool SaveSession::AbortHistoryGroup() {
    if (!IsLoaded()) {
        return false;
    }
    return ledger_.AbortGroup(buffer_);
}

bool SaveSession::UndoLastChange(LedgerEntrySummary *out_undone, std::string *error) {
    if (!IsLoaded()) {
        if (error) {
            *error = "session is empty";
        }
        return false;
    }
    return ledger_.Undo(buffer_, out_undone, error);
}

void SaveSession::ResetToOriginal() {
    if (!IsLoaded()) {
        return;
    }
    ledger_.Reset(buffer_, original_buffer_);
}

void SaveSession::MarkSaved() {
    ledger_.MarkSaved();
}

bool SaveSession::HasUnsavedChanges() const {
    return IsLoaded() && ledger_.HasUnsavedChanges();
}

bool SaveSession::HasUncommittedBagChanges() const {
    return IsLoaded() && ledger_.HasUncommittedBagChanges();
}

bool SaveSession::CanUndo() const {
    return IsLoaded() && ledger_.EntryCount() > 0;
}

bool SaveSession::CanReset() const {
    if (!IsLoaded()) {
        return false;
    }
    return buffer_ != original_buffer_ || ledger_.EntryCount() > 0;
}

size_t SaveSession::TotalChangedBytes() const {
    if (!IsLoaded()) {
        return 0;
    }
    return ledger_.Summary(buffer_, original_buffer_).total_changed_bytes;
}

LedgerSummary SaveSession::History() const {
    if (!IsLoaded()) {
        return LedgerSummary{};
    }
    return ledger_.Summary(buffer_, original_buffer_);
}

const ChangeLedger &SaveSession::Ledger() const {
    return ledger_;
}

} // namespace puse::core

namespace puse::core {
const profile::GameProfile* SaveSession::Profile() const { return profile_; }
}

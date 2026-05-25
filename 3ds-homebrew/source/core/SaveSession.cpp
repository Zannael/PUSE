#include <puse/core/SaveSession.hpp>

#include <fstream>

namespace puse::core {

bool SaveSession::LoadFromFile(const std::string &path, std::string *error) {
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

    buffer_ = std::move(next);
    source_path_ = path;
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
    buffer_.clear();
    source_path_.clear();
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

std::vector<uint8_t> &SaveSession::MutableBuffer() {
    return buffer_;
}

std::vector<SaveSection> SaveSession::Sections() const {
    return ListSections(buffer_);
}

} // namespace puse::core

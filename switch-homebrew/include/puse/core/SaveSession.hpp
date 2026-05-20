#pragma once

#include <string>
#include <vector>

#include <puse/core/SaveSections.hpp>

namespace puse::core {

class SaveSession {
  public:
    bool LoadFromFile(const std::string &path, std::string *error = nullptr);
    bool ExportToFile(const std::string &path, std::string *error = nullptr) const;

    void Clear();

    bool IsLoaded() const;
    const std::string &SourcePath() const;
    std::string FileName() const;

    const std::vector<uint8_t> &Buffer() const;
    std::vector<uint8_t> &MutableBuffer();
    std::vector<SaveSection> Sections() const;

  private:
    std::vector<uint8_t> buffer_;
    std::string source_path_;
};

} // namespace puse::core

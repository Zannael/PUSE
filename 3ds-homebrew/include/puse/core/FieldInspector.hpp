#pragma once
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace puse::core {
struct InspectedField {
    std::string id, label;
    uint16_t section_id;
    size_t relative_offset, file_offset, width;
    int bit = -1;
    std::string raw_hex, decoded, confidence;
};
struct FieldReport {
    std::string profile_id;
    uint32_t save_index = 0;
    std::vector<InspectedField> fields;
};
bool BuildFieldReport(const std::vector<uint8_t>& buffer, FieldReport* out, std::string* error = nullptr);
std::string FieldReportJson(const FieldReport& report);
std::vector<std::string> FieldDetails(const InspectedField& field);
inline constexpr const char* kFieldInspectorNotice = "Known fields for the selected profile; layout evidence does not confirm the ROM version. Unknown flags are not classified.";
} // namespace puse::core

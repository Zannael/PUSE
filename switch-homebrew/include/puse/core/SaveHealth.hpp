#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace puse::core {

struct HealthChecksum {
    int id;
    size_t index;
    std::string status;
    uint16_t stored;
    uint16_t computed;
    bool has_computed;
};

struct HealthField {
    std::string name;
    size_t changed_bytes;
};

struct HealthSector {
    size_t index;
    int id;
    uint32_t save_index;
    size_t payload_bytes;
    size_t footer_bytes;
    std::vector<HealthField> fields;
};

struct SaveHealthReport {
    size_t size;
    size_t section_count;
    size_t trailing_bytes;
    uint32_t active_save_index;
    std::vector<int> missing_ids;
    std::vector<HealthChecksum> checksums;
    std::vector<std::string> warning_codes;
    std::vector<std::string> original_warning_codes;
    size_t changed_bytes;
    std::vector<HealthSector> sectors;
};

SaveHealthReport BuildSaveHealthReport(const std::vector<uint8_t> &original, const std::vector<uint8_t> &current);

} // namespace puse::core

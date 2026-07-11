#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

namespace puse::core {

constexpr size_t kSectionSize = 0x1000;
constexpr size_t kFooterValidLenOffset = 0xFF0;
constexpr size_t kFooterIdOffset = 0xFF4;
constexpr size_t kFooterChecksumOffset = 0xFF6;
constexpr size_t kFooterSaveIndexOffset = 0xFFC;

struct SaveSection {
    size_t index;
    size_t offset;
    uint16_t section_id;
    uint32_t valid_len;
    uint16_t stored_checksum;
    uint32_t save_index;
};

uint16_t ComputeSectionChecksum(const uint8_t *payload, size_t payload_len, uint32_t valid_len);
std::vector<SaveSection> ListSections(const std::vector<uint8_t> &buffer);
uint16_t ComputeSectionChecksumForSection(const std::vector<uint8_t> &buffer, const SaveSection &section);
bool IsSectionChecksumValid(const std::vector<uint8_t> &buffer, const SaveSection &section);
bool RecalculateSectionChecksum(std::vector<uint8_t> &buffer, size_t section_offset);

} // namespace puse::core

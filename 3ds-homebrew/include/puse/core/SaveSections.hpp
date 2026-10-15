#pragma once

#include <puse/core/GameProfile.hpp>

#include <cstddef>
#include <cstdint>
#include <vector>

namespace puse::core {

constexpr size_t kSectionSize = profile::kContainerSectionSize;
constexpr size_t kFooterValidLenOffset = profile::kContainerFooterPayloadEnd;
constexpr size_t kFooterIdOffset = profile::kContainerFooterId;
constexpr size_t kFooterChecksumOffset = profile::kContainerFooterChecksum;
constexpr size_t kFooterSaveIndexOffset = profile::kContainerFooterCounter;

struct SaveSection {
    size_t index;
    size_t offset;
    uint16_t section_id;
    uint32_t valid_len;
    uint16_t stored_checksum;
    uint32_t save_index;
};

size_t UnboundChecksumLength(uint16_t id);
std::vector<const profile::GameProfile*> RecognizeProfiles(const std::vector<uint8_t>& buffer);
bool ChooseProfile(const std::vector<uint8_t>& buffer, const std::string& requested, const profile::GameProfile** out, std::string* error);
std::vector<SaveSection> ActiveUnboundSections(const std::vector<uint8_t>& buffer, bool verify_checksums = true);

uint16_t ComputeSectionChecksum(const uint8_t *payload, size_t payload_len, uint32_t valid_len);
std::vector<SaveSection> ListSections(const std::vector<uint8_t> &buffer);
uint16_t ComputeSectionChecksumForSection(const std::vector<uint8_t> &buffer, const SaveSection &section);
bool IsSectionChecksumValid(const std::vector<uint8_t> &buffer, const SaveSection &section);
bool RecalculateSectionChecksum(std::vector<uint8_t> &buffer, size_t section_offset);

} // namespace puse::core

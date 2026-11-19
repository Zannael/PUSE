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

struct CompatibilityReport {
    size_t size = 0;
    std::string profile_id;
    std::vector<std::string> candidates, blockers;
    int64_t structural_generation = -1, editable_generation = -1;
    bool uses_older_generation = false, mutations_allowed = false;
    std::vector<uint16_t> opaque_section_ids;
};
CompatibilityReport BuildCompatibilityReport(const std::vector<uint8_t>& buffer, const std::string& requested = "");
std::string CompatibilityReportJson(const CompatibilityReport& report);
std::vector<std::string> CompatibilityDetails(const CompatibilityReport& report);

size_t UnboundChecksumLength(uint16_t id);
std::vector<const profile::GameProfile*> RecognizeProfiles(const std::vector<uint8_t>& buffer);
bool ChooseProfile(const std::vector<uint8_t>& buffer, const std::string& requested, const profile::GameProfile** out, std::string* error);
std::vector<SaveSection> ActiveUnboundSections(const std::vector<uint8_t>& buffer, bool verify_checksums = true, const profile::GameProfile* game = nullptr);

uint16_t ComputeSectionChecksum(const uint8_t *payload, size_t payload_len, uint32_t valid_len);
std::vector<SaveSection> ListSections(const std::vector<uint8_t> &buffer);
uint16_t ComputeSectionChecksumForSection(const std::vector<uint8_t> &buffer, const SaveSection &section);
bool IsSectionChecksumValid(const std::vector<uint8_t> &buffer, const SaveSection &section);
bool RecalculateSectionChecksum(std::vector<uint8_t> &buffer, size_t section_offset);

} // namespace puse::core

#pragma once

#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

namespace puse::core {

struct RtcChange {
    int rel_off;
    uint8_t from_byte;
    uint8_t to_byte;
};

struct RtcSectionEntry {
    int sid = 0;
    uint32_t broken_save_idx = 0;
    uint16_t broken_checksum = 0;
    uint32_t fixed_save_idx = 0;
    uint16_t fixed_checksum = 0;
    int count = 0;
    std::vector<RtcChange> changes;
};

struct RtcManifest {
    int format = 0;
    std::unordered_map<int, RtcSectionEntry> changes_by_id;
    std::unordered_map<std::string, std::vector<int>> profiles;
    bool loaded = false;
};

// Load manifest JSON from path (romfs or sdmc).
bool LoadRtcManifest(const std::string &path, RtcManifest *out, std::string *error = nullptr);

// Build quick-fix candidates from a single tampered save + preloaded manifest.
// Mirrors build_quick_candidates_from_single() from rtc_repair_from_pair.py
struct RtcQuickResult {
    uint32_t source_idx = 0;
    uint32_t target_idx = 0;
    // ordered profile name -> candidate save bytes (use kQuickProfileOrder for display order)
    std::unordered_map<std::string, std::vector<uint8_t>> candidates;
};

bool BuildQuickCandidates(const std::vector<uint8_t> &tampered,
                          const RtcManifest &manifest,
                          RtcQuickResult *out,
                          std::string *error = nullptr);

// Ordered profile names for quick-fix candidates.
extern const char *kQuickProfileOrder[3];

// Build pair-repair candidates from broken + fixed saves.
// Builds manifest internally, then generates DEFAULT_PROFILES candidates.
struct RtcCandidateInfo {
    std::vector<uint8_t> bytes;
    std::vector<std::string> issues;
};

struct RtcPairResult {
    std::unordered_map<std::string, RtcCandidateInfo> candidates;
    RtcManifest manifest;
};

bool BuildPairCandidates(const std::vector<uint8_t> &broken,
                         const std::vector<uint8_t> &fixed,
                         RtcPairResult *out,
                         std::string *error = nullptr);

// Ordered profile names for pair candidates.
extern const char *kPairProfileOrder[7];

// Write candidate save files to sdmc:/switch/puse/rtc/.
// Creates the directory if absent. Returns number of files written, -1 on fatal error.
int WriteRtcCandidates(const std::unordered_map<std::string, std::vector<uint8_t>> &candidates,
                       const char *const *profile_order, int profile_count,
                       std::string *error = nullptr);

} // namespace puse::core

#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace puse::core {

constexpr uint16_t kPokedexFlagTrainerSectionId = 1;
constexpr uint32_t kPokedexSeenOffset = 0x0310;
constexpr uint32_t kPokedexCaughtOffset = 0x038D;
constexpr uint32_t kPokedexFlagByteCount = 125;
constexpr uint16_t kMaxTrackedDexId = 999;

struct PokedexFlags {
    bool trackable = false;
    bool seen = false;
    bool caught = false;
};

bool IsDexSpeciesTrackable(uint16_t species_id);
PokedexFlags GetPokedexFlags(const std::vector<uint8_t> &buffer, uint16_t species_id);
bool SetPokedexFlag(std::vector<uint8_t> &buffer, uint16_t species_id, const std::string &flag, bool value, PokedexFlags *out = nullptr);

} // namespace puse::core

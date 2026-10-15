#pragma once

#include <puse/core/GameProfile.hpp>

#include <cstdint>
#include <string>
#include <vector>

namespace puse::core {

constexpr uint16_t kPokedexFlagTrainerSectionId = profile::kStoragePokedexSectionId;
constexpr uint32_t kPokedexSeenOffset = profile::kStoragePokedexSeenOffset;
constexpr uint32_t kPokedexCaughtOffset = profile::kStoragePokedexCaughtOffset;
constexpr uint32_t kPokedexFlagByteCount = profile::kStoragePokedexByteCount;
constexpr uint16_t kMaxTrackedDexId = profile::kStoragePokedexMaxDexId;

struct PokedexFlags {
    bool trackable = false;
    bool seen = false;
    bool caught = false;
};

bool IsDexSpeciesTrackable(uint16_t species_id);
uint16_t DexIdForSpecies(uint16_t species_id);
PokedexFlags GetPokedexFlags(const std::vector<uint8_t> &buffer, uint16_t species_id);
bool SetPokedexFlag(std::vector<uint8_t> &buffer, uint16_t species_id, const std::string &flag, bool value, PokedexFlags *out = nullptr);

} // namespace puse::core

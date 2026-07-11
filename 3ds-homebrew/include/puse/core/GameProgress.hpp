#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace puse::core {

struct GameProgressSnapshot {
    int badge_count = 0;
    uint16_t active_level_cap = 20;
    uint16_t normal_level_cap = 20;
    uint16_t expert_level_cap = 15;
    std::string cap_profile = "normal";
    uint16_t effective_level_cap = 20;
    bool difficulty_flag_known = false;
    bool is_champion = false;
    bool mega_unlocked = false;
    uint32_t money = 0;
    uint16_t battle_points = 0;
    bool tm_case_owned = false;
    std::vector<uint16_t> owned_tmhm_item_ids;
    bool dexnav = false;
    bool stat_scanner = false;
    bool mega_ring = false;
    uint32_t heart_scale = 0;
    uint32_t dream_mist = 0;
    uint32_t bottle_cap = 0;
    uint32_t gold_bottle_cap = 0;
};

bool BuildGameProgressSnapshot(const std::vector<uint8_t> &buffer,
                               const std::string &cap_profile,
                               GameProgressSnapshot *out,
                               std::string *error = nullptr);

} // namespace puse::core

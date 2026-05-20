#pragma once

#include <cstdint>
#include <array>
#include <string>
#include <optional>
#include <unordered_map>
#include <vector>

namespace puse::core {

struct PartyEntry {
    int index;
    uint32_t pid;
    uint32_t otid;
    std::string nickname;
    uint16_t species_id;
    std::string species_name;
    uint16_t item_id;
    uint32_t exp;
    uint8_t level;
    uint8_t nature_id;
    std::string nature_name;
    bool is_shiny;
    std::string gender;
    std::string gender_mode;
    bool gender_editable;
    bool hidden_ability;
    uint8_t ability_slot;
    int current_ability_index;
    uint16_t ability_1_id;
    std::string ability_1_name;
    uint16_t ability_2_id;
    std::string ability_2_name;
    uint16_t ability_hidden_id;
    std::string ability_hidden_name;
    uint16_t effective_ability_id;
    std::string effective_ability_name;
    std::string ability_label_current;
    int species_growth_rate;
    std::array<uint8_t, 6> ivs;
    std::array<uint8_t, 6> evs;
    std::array<uint16_t, 4> move_ids;
    std::array<uint8_t, 4> move_pp;
    std::array<uint8_t, 4> move_pp_ups;
    std::array<uint8_t, 4> move_pp_max;
};

struct PartyLevelResult {
    int requested_level;
    int target_level;
    bool was_clamped;
    uint32_t exp;
    int growth_rate;
    std::string growth_name;
    std::string confidence;
};

std::vector<PartyEntry> ParseParty(
    const std::vector<uint8_t> &buffer,
    const std::unordered_map<int, std::string> &species_db
);

bool EnsurePartyStaticDataLoaded(std::string *error = nullptr);

bool UpdatePartyNickname(std::vector<uint8_t> &buffer, int index, const std::string &nickname, std::string *error = nullptr);
bool UpdatePartyItem(std::vector<uint8_t> &buffer, int index, uint16_t item_id, std::string *error = nullptr);
bool UpdatePartySpecies(std::vector<uint8_t> &buffer, int index, uint16_t species_id, std::string *error = nullptr);
bool UpdatePartyNature(std::vector<uint8_t> &buffer, int index, uint8_t nature_id, std::string *error = nullptr);
bool UpdatePartyIdentity(
    std::vector<uint8_t> &buffer,
    int index,
    const std::optional<bool> &shiny,
    const std::optional<std::string> &gender,
    std::string *error = nullptr
);
bool UpdatePartyAbilitySwitch(std::vector<uint8_t> &buffer, int index, int ability_index, std::string *error = nullptr);
bool UpdatePartyAbilityFlag(std::vector<uint8_t> &buffer, int index, bool is_hidden, std::string *error = nullptr);
bool UpdatePartyIvs(std::vector<uint8_t> &buffer, int index, const std::array<uint8_t, 6> &ivs, std::string *error = nullptr);
bool UpdatePartyEvs(std::vector<uint8_t> &buffer, int index, const std::array<uint8_t, 6> &evs, std::string *error = nullptr);
bool UpdatePartyMoves(
    std::vector<uint8_t> &buffer,
    int index,
    const std::array<uint16_t, 4> &moves,
    const std::optional<std::array<uint8_t, 4>> &move_pp,
    const std::optional<std::array<uint8_t, 4>> &move_pp_ups,
    std::string *error = nullptr
);
bool UpdatePartyLevel(
    std::vector<uint8_t> &buffer,
    int index,
    int requested_level,
    const std::optional<int> &growth_rate,
    PartyLevelResult *result = nullptr,
    std::string *error = nullptr
);

bool CommitPartySectionChecksums(std::vector<uint8_t> &buffer, std::string *error = nullptr);

// --- Query utilities (shared with Pc, Money, etc.) ---
// All require EnsurePartyStaticDataLoaded() to have been called first.
int GetSpeciesGrowthRate(int species_id);
int CalcLevelFromExp(int growth_rate, uint32_t exp);
uint32_t GetExpForLevel(int growth_rate, int level);
int GetMoveBasePp(int move_id);
int CalcMaxMovePp(int move_id, int pp_ups);
bool IsShinyFromOtidPid(uint32_t otid, uint32_t pid);
std::string GenderFromPidAndSpecies(uint16_t species_id, uint32_t pid);

} // namespace puse::core

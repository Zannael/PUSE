#pragma once

#include <array>
#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

namespace puse::core {

constexpr size_t kPcMonSize = 58;
constexpr int kPcStreamBoxCount = 18;
constexpr int kPcBoxSlotCount = 30;

struct PcMon {
    int box;
    int slot;
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
    bool hidden_ability;
    std::array<uint8_t, 6> ivs;       // [HP, Atk, Def, Spe, SpA, SpD]
    std::array<uint8_t, 6> evs;       // [HP, Atk, Def, Spe, SpA, SpD]
    std::array<uint16_t, 4> move_ids;
    std::array<uint8_t, 4> move_pp_ups;
    std::array<uint8_t, 4> move_pp_max;  // derived (no current PP in compact format)
};

// Build the 32640-byte PC stream from save buffer (sectors 5-12, 0xFF0 bytes each).
std::vector<uint8_t> BuildPcStream(const std::vector<uint8_t> &buffer, std::string *error = nullptr);

// Write pc_stream back into the save buffer and recompute PC sector checksums.
bool CommitPcStream(std::vector<uint8_t> &buffer, const std::vector<uint8_t> &stream, std::string *error = nullptr);

// Parse all valid mons in a box from the stream. box is 1-based [1..kPcStreamBoxCount].
std::vector<PcMon> ParsePcBox(
    const std::vector<uint8_t> &stream,
    int box,
    const std::unordered_map<int, std::string> &species_db
);

// Count valid (non-empty) mons in a box without full decode.
int CountPcBoxMons(const std::vector<uint8_t> &stream, int box);

// Slot mutations — box and slot are 1-based.
bool UpdatePcMonNickname(std::vector<uint8_t> &stream, int box, int slot, const std::string &nickname, std::string *error = nullptr);
bool UpdatePcMonSpecies(std::vector<uint8_t> &stream, int box, int slot, uint16_t species_id, std::string *error = nullptr);
bool UpdatePcMonItem(std::vector<uint8_t> &stream, int box, int slot, uint16_t item_id, std::string *error = nullptr);
bool UpdatePcMonLevel(std::vector<uint8_t> &stream, int box, int slot, int level, std::string *error = nullptr);
bool UpdatePcMonIvs(std::vector<uint8_t> &stream, int box, int slot, const std::array<uint8_t, 6> &ivs, std::string *error = nullptr);
bool UpdatePcMonEvs(std::vector<uint8_t> &stream, int box, int slot, const std::array<uint8_t, 6> &evs, std::string *error = nullptr);
bool UpdatePcMonMoves(
    std::vector<uint8_t> &stream, int box, int slot,
    const std::array<uint16_t, 4> &moves,
    const std::array<uint8_t, 4> *pp_ups,
    std::string *error = nullptr
);
bool UpdatePcMonNature(std::vector<uint8_t> &stream, int box, int slot, uint8_t nature_id, std::string *error = nullptr);
bool UpdatePcMonShiny(std::vector<uint8_t> &stream, int box, int slot, bool shiny, std::string *error = nullptr);
bool UpdatePcMonHiddenAbility(std::vector<uint8_t> &stream, int box, int slot, bool hidden, std::string *error = nullptr);

} // namespace puse::core

#pragma once

#include <cstdint>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace puse::core {

struct BagSlot {
    uint16_t item_id;
    uint16_t qty;
    uint32_t offset;
    bool encoding_swapped;
};

struct BagPocket {
    std::string pocket_type;     // "main"|"ball"|"key"|"tm"|"berry"
    uint32_t anchor_offset = 0;
    std::string quality;         // "strict"|"medium"|"empty"|"reject"|"unavailable"
    int slot_count = 0;
    int dup_count = 0;
    std::string source;
    std::string confidence;
    bool ready = false;
    bool locked = false;
    uint16_t requires_key_item = 0;
    std::string locked_reason;
    bool is_empty_candidate = false;
};

// Load pocket ID sets from item_pocket_map.json (call once; idempotent).
bool EnsureBagDataLoaded(std::string *error = nullptr);

// Bootstrap quick pockets (main/ball/key/tm/berry). Returns map pocket_type→BagPocket.
std::unordered_map<std::string, BagPocket> ResolveQuickPockets(const std::vector<uint8_t> &buf);

// Read slots in pocket starting from anchor_offset. Returns filled+empty slots.
std::vector<BagSlot> MapPocketFromAnchor(const std::vector<uint8_t> &buf, uint32_t anchor_offset);

// Write item_id/qty to a single slot, respecting encoding.
void WriteSlot(std::vector<uint8_t> &buf, uint32_t offset, uint16_t item_id, uint16_t qty, bool encoding_swapped);

// Recompute GBA checksums for all bag sector copies (IDs 13–16).
// Sector id=13 uses fixed valid_len=0x450 (Unbound special case).
bool CommitBagSectorChecksums(std::vector<uint8_t> &buf, std::string *error = nullptr);

// Classify item into "main"|"ball"|"key"|"tm"|"hm"|"generic".
std::string PocketTypeForItemId(uint16_t item_id);

// Pocket ID set accessors (needed by UI for display/constraints).
const std::unordered_set<uint16_t> &GetTmHmItemIds();
const std::unordered_set<uint16_t> &GetKeyItemIds();

std::vector<uint16_t> CollectOwnedTmHmItemIds(const std::vector<uint8_t> &buf, bool *tm_case_owned = nullptr);

} // namespace puse::core

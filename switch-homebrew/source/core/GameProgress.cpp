#include <puse/core/GameProgress.hpp>

#include <algorithm>

#include <puse/core/Bag.hpp>
#include <puse/core/Binary.hpp>
#include <puse/core/Money.hpp>
#include <puse/core/SaveSections.hpp>

namespace puse::core {
namespace {

constexpr size_t kSaveBlock1ChunkSizes[] = {0xFF0, 0xFF0, 0xFF0, 0xD98};
constexpr uint16_t kSaveBlock1SectionIds[] = {1, 2, 3, 4};
constexpr uint32_t kSaveBlock1FlagsOffset = 0x0EE0;
constexpr uint32_t kExpandedFlagsBase = 0x900;
constexpr uint16_t kExpandedFlagsSectionId = 4;
constexpr uint32_t kExpandedFlagsSectionOffset = 0xD98;
constexpr uint32_t kExpandedFlagsSize = 0x258;

constexpr uint32_t kFlagBadge01Get = 0x820;
constexpr uint32_t kFlagBadge08Get = 0x827;
constexpr uint32_t kFlagSysGameClear = 0x82C;
constexpr uint32_t kFlagSysDexnav = 0x91E;

constexpr uint16_t kItemHeartScale = 111;
constexpr uint16_t kItemDreamMist = 89;
constexpr uint16_t kItemBottleCap = 616;
constexpr uint16_t kItemGoldBottleCap = 617;
constexpr uint16_t kItemStatScanner = 278;
constexpr uint16_t kItemMegaRing = 353;
constexpr uint16_t kItemMegaCuff = 119;
constexpr uint16_t kItemMegaCharm = 528;
constexpr uint16_t kItemMegaBracelet = 529;
constexpr uint16_t kBagSectorIds[] = {13, 14, 15, 16};

constexpr uint16_t kNormalCaps[] = {20, 26, 32, 36, 40, 52, 57, 61, 75};
constexpr uint16_t kExpertCaps[] = {15, 32, 45, 55, 64, 68, 72, 75, 75, 75, 78, 78, 80, 80};

const SaveSection *FindActiveSection(const std::vector<SaveSection> &sections, const uint16_t section_id) {
    const SaveSection *best = nullptr;
    for (const auto &s : sections) {
        if (s.section_id != section_id) { continue; }
        if ((best == nullptr) || (s.save_index > best->save_index)) {
            best = &s;
        }
    }
    return best;
}

bool SaveBlock1OffsetToSection(const uint32_t abs_offset, uint16_t *section_id, uint32_t *rel_offset) {
    uint32_t remaining = abs_offset;
    for (size_t i = 0; i < 4; ++i) {
        if (remaining < kSaveBlock1ChunkSizes[i]) {
            *section_id = kSaveBlock1SectionIds[i];
            *rel_offset = remaining;
            return true;
        }
        remaining -= static_cast<uint32_t>(kSaveBlock1ChunkSizes[i]);
    }
    return false;
}

bool ReadFlagBit(const std::vector<uint8_t> &buf, const std::vector<SaveSection> &sections,
                 const uint16_t section_id, const uint32_t rel_offset, const uint32_t bit_index) {
    const SaveSection *section = FindActiveSection(sections, section_id);
    if (section == nullptr) { return false; }
    const size_t abs_offset = section->offset + rel_offset;
    if (abs_offset >= buf.size()) { return false; }
    return ((buf[abs_offset] >> bit_index) & 1U) == 1U;
}

bool ReadStandardEventFlag(const std::vector<uint8_t> &buf, const std::vector<SaveSection> &sections,
                           const uint32_t flag_id) {
    const uint32_t byte_offset = kSaveBlock1FlagsOffset + (flag_id / 8U);
    const uint32_t bit_index = flag_id % 8U;
    uint16_t section_id = 0;
    uint32_t rel_offset = 0;
    if (!SaveBlock1OffsetToSection(byte_offset, &section_id, &rel_offset)) { return false; }
    return ReadFlagBit(buf, sections, section_id, rel_offset, bit_index);
}

bool ReadExpandedEventFlag(const std::vector<uint8_t> &buf, const std::vector<SaveSection> &sections,
                           const uint32_t flag_id) {
    if ((flag_id < kExpandedFlagsBase) || (flag_id >= 0x1900U)) { return false; }
    const uint32_t flag_index = flag_id - kExpandedFlagsBase;
    const uint32_t byte_offset = kExpandedFlagsSectionOffset + (flag_index / 8U);
    if (byte_offset >= (kExpandedFlagsSectionOffset + kExpandedFlagsSize)) { return false; }
    return ReadFlagBit(buf, sections, kExpandedFlagsSectionId, byte_offset, flag_index % 8U);
}

bool ReadEventFlag(const std::vector<uint8_t> &buf, const std::vector<SaveSection> &sections, const uint32_t flag_id) {
    if ((flag_id >= kExpandedFlagsBase) && (flag_id < 0x1900U)) {
        return ReadExpandedEventFlag(buf, sections, flag_id);
    }
    if (flag_id >= 0x4000U) { return false; }
    return ReadStandardEventFlag(buf, sections, flag_id);
}

int CountBadges(const std::vector<uint8_t> &buf, const std::vector<SaveSection> &sections) {
    int count = 0;
    for (uint32_t flag = kFlagBadge01Get; flag <= kFlagBadge08Get; ++flag) {
        if (ReadEventFlag(buf, sections, flag)) { ++count; }
    }
    return count;
}

uint32_t SumItemQuantity(const std::vector<BagSlot> &slots, const uint16_t item_id) {
    uint32_t total = 0;
    for (const auto &slot : slots) {
        if (slot.item_id == item_id) { total += slot.qty; }
    }
    return total;
}

bool HasItem(const std::vector<BagSlot> &slots, const uint16_t item_id) {
    return SumItemQuantity(slots, item_id) > 0;
}

bool IsBagSectorId(const uint16_t section_id) {
    for (const auto id : kBagSectorIds) {
        if (id == section_id) { return true; }
    }
    return false;
}

bool HasItemInActiveBagSectors(const std::vector<uint8_t> &buf, const std::vector<SaveSection> &sections,
                               const uint16_t item_id) {
    uint32_t active_idx = 0;
    for (const auto &s : sections) {
        if (IsBagSectorId(s.section_id) && s.save_index > active_idx) {
            active_idx = s.save_index;
        }
    }
    for (const auto &s : sections) {
        if (!IsBagSectorId(s.section_id) || s.save_index == 0) { continue; }
        if (active_idx > 0 && s.save_index != active_idx) { continue; }
        const size_t end = std::min(s.offset + kFooterValidLenOffset, buf.size());
        for (size_t off = s.offset; off + 3 < end; off += 2) {
            const uint16_t iid = ReadU16Le(buf.data(), off);
            const uint16_t qty = ReadU16Le(buf.data(), off + 2);
            const uint16_t swapped_qty = ReadU16Le(buf.data(), off);
            const uint16_t swapped_iid = ReadU16Le(buf.data(), off + 2);
            if ((iid == item_id && qty > 0) || (swapped_iid == item_id && swapped_qty > 0)) { return true; }
        }
    }
    return false;
}

bool HasItemAnywhere(const std::vector<uint8_t> &buf, const uint16_t item_id) {
    for (size_t off = 0; off + 3 < buf.size(); off += 2) {
        const uint16_t iid = ReadU16Le(buf.data(), off);
        const uint16_t qty = ReadU16Le(buf.data(), off + 2);
        const uint16_t swapped_qty = ReadU16Le(buf.data(), off);
        const uint16_t swapped_iid = ReadU16Le(buf.data(), off + 2);
        if ((iid == item_id && qty > 0) || (swapped_iid == item_id && swapped_qty > 0)) { return true; }
    }
    return false;
}

} // namespace

bool BuildGameProgressSnapshot(const std::vector<uint8_t> &buffer,
                               const std::string &cap_profile,
                               GameProgressSnapshot *out,
                               std::string *error) {
    if (out == nullptr) {
        if (error != nullptr) { *error = "output snapshot is null"; }
        return false;
    }

    EnsureBagDataLoaded(nullptr);
    const auto sections = ListSections(buffer);
    const bool champion = ReadEventFlag(buffer, sections, kFlagSysGameClear);
    const int badges = CountBadges(buffer, sections);
    const size_t normal_index = badges <= 0 ? 0U : std::min(static_cast<size_t>(badges), (sizeof(kNormalCaps) / sizeof(kNormalCaps[0])) - 1U);
    const size_t expert_index = badges <= 0 ? 0U : std::min(static_cast<size_t>(badges), (sizeof(kExpertCaps) / sizeof(kExpertCaps[0])) - 1U);

    GameProgressSnapshot snapshot;
    snapshot.badge_count = badges;
    snapshot.is_champion = champion;
    snapshot.normal_level_cap = champion ? 100 : kNormalCaps[normal_index];
    snapshot.active_level_cap = snapshot.normal_level_cap;
    snapshot.expert_level_cap = champion ? 100 : kExpertCaps[expert_index];
    snapshot.cap_profile = cap_profile == "expert" ? "expert" : "normal";
    snapshot.effective_level_cap = snapshot.cap_profile == "expert" ? snapshot.expert_level_cap : snapshot.normal_level_cap;
    snapshot.difficulty_flag_known = false;

    ReadMoney(buffer, &snapshot.money, nullptr);
    ReadBp(buffer, &snapshot.battle_points, nullptr);

    const auto pockets = ResolveQuickPockets(buffer);
    std::vector<BagSlot> owned_slots;
    for (const auto &entry : pockets) {
        for (const auto &slot : MapPocketFromAnchor(buffer, entry.second.anchor_offset)) {
            if (slot.item_id > 0) { owned_slots.push_back(slot); }
        }
    }

    snapshot.dexnav = ReadEventFlag(buffer, sections, kFlagSysDexnav);
    snapshot.stat_scanner = HasItem(owned_slots, kItemStatScanner) || HasItemAnywhere(buffer, kItemStatScanner);
    snapshot.mega_ring = HasItem(owned_slots, kItemMegaRing) || HasItemInActiveBagSectors(buffer, sections, kItemMegaRing);
    snapshot.mega_unlocked = snapshot.mega_ring ||
        HasItem(owned_slots, kItemMegaCuff) || HasItemInActiveBagSectors(buffer, sections, kItemMegaCuff) ||
        HasItem(owned_slots, kItemMegaCharm) || HasItemInActiveBagSectors(buffer, sections, kItemMegaCharm) ||
        HasItem(owned_slots, kItemMegaBracelet) || HasItemInActiveBagSectors(buffer, sections, kItemMegaBracelet);
    snapshot.heart_scale = SumItemQuantity(owned_slots, kItemHeartScale);
    snapshot.dream_mist = SumItemQuantity(owned_slots, kItemDreamMist);
    snapshot.bottle_cap = SumItemQuantity(owned_slots, kItemBottleCap);
    snapshot.gold_bottle_cap = SumItemQuantity(owned_slots, kItemGoldBottleCap);
    snapshot.owned_tmhm_item_ids = CollectOwnedTmHmItemIds(buffer, &snapshot.tm_case_owned);

    *out = snapshot;
    return true;
}

} // namespace puse::core

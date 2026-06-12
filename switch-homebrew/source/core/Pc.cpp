#include <puse/core/Pc.hpp>

#include <algorithm>
#include <array>
#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

#include <puse/core/Binary.hpp>
#include <puse/core/Party.hpp>
#include <puse/core/SaveSections.hpp>

namespace puse::core {

namespace {

// --- CFRU compact PC mon offsets (58-byte format) ---
constexpr size_t kPcPidOff     = 0x00;
constexpr size_t kPcOtidOff    = 0x04;
constexpr size_t kPcNickOff    = 0x08;  // 10 bytes
constexpr size_t kPcSpeciesOff = 0x1C;
constexpr size_t kPcItemOff    = 0x1E;
constexpr size_t kPcExpOff     = 0x20;
constexpr size_t kPcPpUpsOff   = 0x24;  // 1 byte, 4×2-bit
constexpr size_t kPcBallOff    = 0x26;
constexpr size_t kPcMovesOff   = 0x27;  // 5 bytes, 4×10-bit move IDs
constexpr size_t kPcEvsOff     = 0x2C;  // 6 bytes [HP,Atk,Def,Spe,SpA,SpD]
constexpr size_t kPcIvsOff     = 0x36;  // u32: bits 0-4=HP,5-9=Atk,10-14=Def,15-19=Spe,20-24=SpA,25-29=SpD,bit31=HA

// PC stream sectors (IDs 5–12 inclusive, each contributes 0xFF0 bytes after a 4-byte header)
constexpr int kPcSectorFirst  = 5;
constexpr int kPcSectorLast   = 12;
constexpr size_t kSectorHeaderSize   = 4;
constexpr size_t kSectorPayloadSize  = 0xFF0;

constexpr uint32_t kMaxValidExp     = 2000000U;
constexpr uint16_t kMaxValidSpecies = 2500U;

const std::array<const char *, 25> kNatureNames = {
    "Hardy", "Lonely", "Brave", "Adamant", "Naughty", "Bold", "Docile", "Relaxed", "Impish", "Lax",
    "Timid", "Hasty", "Serious", "Jolly", "Naive", "Modest", "Mild", "Quiet", "Bashful", "Rash",
    "Calm", "Gentle", "Sassy", "Careful", "Quirky",
};

// --- Text codec (same simplified charmap as Party.cpp for consistency) ---
const std::unordered_map<uint8_t, char> kDecodeCharmap = {
    {0x00, ' '}, {0xAB, '!'}, {0xAC, '?'}, {0xAD, '.'}, {0xAE, '-'},
    {0xB0, '0'}, {0xB1, '1'}, {0xB2, '2'}, {0xB3, '3'}, {0xB4, '4'},
    {0xB5, '5'}, {0xB6, '6'}, {0xB7, '7'}, {0xB8, '8'}, {0xB9, '9'},
};

std::unordered_map<char, uint8_t> BuildEncodeCharmap() {
    std::unordered_map<char, uint8_t> out = {
        {' ', 0x00}, {'!', 0xAB}, {'?', 0xAC}, {'.', 0xAD}, {'-', 0xAE}, {'\'', 0xB4},
    };
    for (int i = 0; i < 10; ++i) {
        out[static_cast<char>('0' + i)] = static_cast<uint8_t>(0xB0 + i);
    }
    for (int i = 0; i < 26; ++i) {
        out[static_cast<char>('A' + i)] = static_cast<uint8_t>(0xBB + i);
        out[static_cast<char>('a' + i)] = static_cast<uint8_t>(0xD5 + i);
    }
    return out;
}
const std::unordered_map<char, uint8_t> kEncodeCharmap = BuildEncodeCharmap();

std::string DecodeText(const uint8_t *buf, const size_t len) {
    std::string out;
    out.reserve(len);
    for (size_t i = 0; i < len; ++i) {
        const uint8_t b = buf[i];
        if (b == 0xFF) { break; }
        if ((b >= 0xBB) && (b <= 0xD4)) {
            out.push_back(static_cast<char>('A' + (b - 0xBB)));
        } else if ((b >= 0xD5) && (b <= 0xEE)) {
            out.push_back(static_cast<char>('a' + (b - 0xD5)));
        } else {
            auto it = kDecodeCharmap.find(b);
            out.push_back((it == kDecodeCharmap.end()) ? '?' : it->second);
        }
    }
    while (!out.empty() && out.back() == ' ') { out.pop_back(); }
    return out;
}

void EncodeText(const std::string &text, uint8_t *out_buf, const size_t len) {
    std::fill(out_buf, out_buf + len, 0xFF);
    const std::string safe = text.substr(0, len);
    for (size_t i = 0; i < safe.size(); ++i) {
        auto it = kEncodeCharmap.find(safe[i]);
        out_buf[i] = (it == kEncodeCharmap.end()) ? 0xAC : it->second;
    }
}

// Stream offset for box (1-based) and slot (1-based).
size_t SlotStreamOffset(const int box, const int slot) {
    return static_cast<size_t>(((box - 1) * kPcBoxSlotCount + (slot - 1)) * static_cast<int>(kPcMonSize));
}

bool SlotInStreamBounds(const std::vector<uint8_t> &stream, const int box, const int slot) {
    const size_t off = SlotStreamOffset(box, slot);
    return (off + kPcMonSize) <= stream.size();
}

bool IsPcMonValid(const uint8_t *mon) {
    const uint16_t species = ReadU16Le(mon, kPcSpeciesOff);
    const uint32_t exp = ReadU32Le(mon, kPcExpOff);
    return (species > 0) && (species <= kMaxValidSpecies) && (exp > 0) && (exp <= kMaxValidExp);
}

// Read 4×10-bit packed moves from 5 bytes at kPcMovesOff.
std::array<uint16_t, 4> ReadPcMoves(const uint8_t *mon) {
    uint64_t packed = 0;
    for (int i = 0; i < 5; ++i) {
        packed |= static_cast<uint64_t>(mon[kPcMovesOff + static_cast<size_t>(i)]) << (8 * i);
    }
    std::array<uint16_t, 4> out{};
    for (int i = 0; i < 4; ++i) {
        out[static_cast<size_t>(i)] = static_cast<uint16_t>((packed >> (i * 10)) & 0x3FFU);
    }
    return out;
}

// Write 4×10-bit packed moves to 5 bytes at kPcMovesOff.
void WritePcMoves(uint8_t *mon, const std::array<uint16_t, 4> &moves) {
    uint64_t packed = 0;
    for (int i = 0; i < 5; ++i) {
        packed |= static_cast<uint64_t>(mon[kPcMovesOff + static_cast<size_t>(i)]) << (8 * i);
    }
    for (int i = 0; i < 4; ++i) {
        const int shift = i * 10;
        packed &= ~(static_cast<uint64_t>(0x3FF) << shift);
        packed |= (static_cast<uint64_t>(moves[static_cast<size_t>(i)]) & 0x3FFU) << shift;
    }
    for (int i = 0; i < 5; ++i) {
        mon[kPcMovesOff + static_cast<size_t>(i)] = static_cast<uint8_t>((packed >> (8 * i)) & 0xFFU);
    }
}

// Read 4×2-bit PP-ups from byte at kPcPpUpsOff.
std::array<uint8_t, 4> ReadPcPpUps(const uint8_t *mon) {
    const uint8_t packed = mon[kPcPpUpsOff];
    return {
        static_cast<uint8_t>((packed >> 0U) & 0x03U),
        static_cast<uint8_t>((packed >> 2U) & 0x03U),
        static_cast<uint8_t>((packed >> 4U) & 0x03U),
        static_cast<uint8_t>((packed >> 6U) & 0x03U),
    };
}

// Write 4×2-bit PP-ups. Zeroes out PP-ups for empty move slots.
void WritePcPpUps(uint8_t *mon, const std::array<uint8_t, 4> &pp_ups) {
    const auto moves = ReadPcMoves(mon);
    uint8_t val = 0;
    for (int i = 0; i < 4; ++i) {
        uint8_t up = static_cast<uint8_t>(std::clamp(static_cast<int>(pp_ups[static_cast<size_t>(i)]), 0, 3));
        if (moves[static_cast<size_t>(i)] == 0) { up = 0; }
        val |= static_cast<uint8_t>((up & 0x03U) << (i * 2));
    }
    mon[kPcPpUpsOff] = val;
}

// Read IVs: [HP,Atk,Def,Spe,SpA,SpD] from packed u32 at kPcIvsOff.
std::array<uint8_t, 6> ReadPcIvs(const uint8_t *mon) {
    const uint32_t val = ReadU32Le(mon, kPcIvsOff);
    return {
        static_cast<uint8_t>((val >> 0U)  & 0x1FU),  // HP
        static_cast<uint8_t>((val >> 5U)  & 0x1FU),  // Atk
        static_cast<uint8_t>((val >> 10U) & 0x1FU),  // Def
        static_cast<uint8_t>((val >> 15U) & 0x1FU),  // Spe
        static_cast<uint8_t>((val >> 20U) & 0x1FU),  // SpA
        static_cast<uint8_t>((val >> 25U) & 0x1FU),  // SpD
    };
}

// Write IVs, preserving HA and IsEgg flags (bits 30-31).
void WritePcIvs(uint8_t *mon, const std::array<uint8_t, 6> &ivs) {
    const uint32_t flags = ReadU32Le(mon, kPcIvsOff) & 0xC0000000U;
    uint32_t val = flags;
    val |= (static_cast<uint32_t>(ivs[0] & 0x1FU)) << 0U;   // HP
    val |= (static_cast<uint32_t>(ivs[1] & 0x1FU)) << 5U;   // Atk
    val |= (static_cast<uint32_t>(ivs[2] & 0x1FU)) << 10U;  // Def
    val |= (static_cast<uint32_t>(ivs[3] & 0x1FU)) << 15U;  // Spe
    val |= (static_cast<uint32_t>(ivs[4] & 0x1FU)) << 20U;  // SpA
    val |= (static_cast<uint32_t>(ivs[5] & 0x1FU)) << 25U;  // SpD
    WriteU32Le(mon, kPcIvsOff, val);
}

// Read EVs: [HP,Atk,Def,Spe,SpA,SpD] from 6 bytes at kPcEvsOff.
std::array<uint8_t, 6> ReadPcEvs(const uint8_t *mon) {
    return {
        mon[kPcEvsOff + 0], mon[kPcEvsOff + 1], mon[kPcEvsOff + 2],
        mon[kPcEvsOff + 3], mon[kPcEvsOff + 4], mon[kPcEvsOff + 5],
    };
}

void WritePcEvs(uint8_t *mon, const std::array<uint8_t, 6> &evs) {
    for (size_t i = 0; i < 6; ++i) {
        mon[kPcEvsOff + i] = evs[i];
    }
}

bool GetHaFlag(const uint8_t *mon) {
    return ((ReadU32Le(mon, kPcIvsOff) >> 31U) & 1U) != 0U;
}

void SetHaFlag(uint8_t *mon, const bool ha) {
    uint32_t val = ReadU32Le(mon, kPcIvsOff);
    if (ha) {
        val |= (1U << 31U);
    } else {
        val &= ~(1U << 31U);
    }
    WriteU32Le(mon, kPcIvsOff, val);
}

// Shiny value: same formula as party.
bool IsShinyPc(const uint32_t otid, const uint32_t pid) {
    const uint16_t tid = static_cast<uint16_t>(otid & 0xFFFFU);
    const uint16_t sid = static_cast<uint16_t>((otid >> 16U) & 0xFFFFU);
    const uint16_t sv = static_cast<uint16_t>(tid ^ sid ^ (pid & 0xFFFFU) ^ ((pid >> 16U) & 0xFFFFU));
    return sv < 16U;
}

// Walk PID to find one with target_nature (% 25), preserving ability bit unless HA.
void SetPcNature(uint8_t *mon, const int target_nature) {
    uint32_t pid = ReadU32Le(mon, kPcPidOff);
    const bool ha = GetHaFlag(mon);
    const uint32_t ability_bit = pid & 1U;
    for (int iter = 0; iter < 0x100000; ++iter) {
        const bool nature_ok = (static_cast<int>(pid % 25U) == target_nature);
        const bool slot_ok = ha || ((pid & 1U) == ability_bit);
        if (nature_ok && slot_ok) { break; }
        pid = (pid + 1U) & 0xFFFFFFFFU;
    }
    WriteU32Le(mon, kPcPidOff, pid);
}

// Walk PID to set shiny, preserving nature.
void SetPcShiny(uint8_t *mon, const bool desired_shiny) {
    const uint32_t otid = ReadU32Le(mon, kPcOtidOff);
    const uint32_t start_pid = ReadU32Le(mon, kPcPidOff);
    const int target_nature = static_cast<int>(start_pid % 25U);

    // First pass: try to preserve nature.
    for (uint32_t delta = 0; delta <= 0xFFFFFFU; ++delta) {
        const uint32_t pid = (start_pid + delta) & 0xFFFFFFFFU;
        if (IsShinyPc(otid, pid) != desired_shiny) { continue; }
        if (static_cast<int>(pid % 25U) == target_nature) {
            WriteU32Le(mon, kPcPidOff, pid);
            return;
        }
    }
    // Second pass: any PID with right shiny state.
    for (uint32_t delta = 0; delta <= 0xFFFFFFU; ++delta) {
        const uint32_t pid = (start_pid + delta) & 0xFFFFFFFFU;
        if (IsShinyPc(otid, pid) == desired_shiny) {
            WriteU32Le(mon, kPcPidOff, pid);
            return;
        }
    }
}

bool ValidatePcSlotArgs(const std::vector<uint8_t> &stream, const int box, const int slot, std::string *error) {
    if ((box < 1) || (box > kPcStreamBoxCount) || (slot < 1) || (slot > kPcBoxSlotCount)) {
        if (error) { *error = "box/slot out of range"; }
        return false;
    }
    if (!SlotInStreamBounds(stream, box, slot)) {
        if (error) { *error = "slot offset out of stream bounds"; }
        return false;
    }
    return true;
}

uint8_t *MutableSlot(std::vector<uint8_t> &stream, const int box, const int slot) {
    return stream.data() + SlotStreamOffset(box, slot);
}

const uint8_t *ConstSlot(const std::vector<uint8_t> &stream, const int box, const int slot) {
    return stream.data() + SlotStreamOffset(box, slot);
}

} // namespace

// --- Public API ---

std::vector<uint8_t> BuildPcStream(const std::vector<uint8_t> &buffer, std::string *error) {
    const auto sections = ListSections(buffer);

    // For each sector ID 5..12, find the one with the highest save_index.
    std::unordered_map<int, const SaveSection *> active;
    for (const auto &s : sections) {
        const int id = static_cast<int>(s.section_id);
        if ((id < kPcSectorFirst) || (id > kPcSectorLast)) { continue; }
        auto it = active.find(id);
        if ((it == active.end()) || (s.save_index > it->second->save_index)) {
            active[id] = &s;
        }
    }

    std::vector<uint8_t> stream;
    stream.reserve(static_cast<size_t>(kPcSectorLast - kPcSectorFirst + 1) * kSectorPayloadSize);

    for (int id = kPcSectorFirst; id <= kPcSectorLast; ++id) {
        auto it = active.find(id);
        if (it == active.end()) {
            if (error) { *error = "PC sector " + std::to_string(id) + " not found"; }
            return {};
        }
        const size_t pay_start = it->second->offset + kSectorHeaderSize;
        const size_t pay_end = pay_start + kSectorPayloadSize;
        if (pay_end > buffer.size()) {
            if (error) { *error = "PC sector " + std::to_string(id) + " payload out of bounds"; }
            return {};
        }
        stream.insert(stream.end(), buffer.begin() + static_cast<ptrdiff_t>(pay_start),
                                    buffer.begin() + static_cast<ptrdiff_t>(pay_end));
    }

    return stream;
}

bool CommitPcStream(std::vector<uint8_t> &buffer, const std::vector<uint8_t> &stream, std::string *error) {
    const size_t expected = static_cast<size_t>(kPcSectorLast - kPcSectorFirst + 1) * kSectorPayloadSize;
    if (stream.size() < expected) {
        if (error) { *error = "stream too short to commit"; }
        return false;
    }

    const auto sections = ListSections(buffer);
    std::unordered_map<int, const SaveSection *> active;
    for (const auto &s : sections) {
        const int id = static_cast<int>(s.section_id);
        if ((id < kPcSectorFirst) || (id > kPcSectorLast)) { continue; }
        auto it = active.find(id);
        if ((it == active.end()) || (s.save_index > it->second->save_index)) {
            active[id] = &s;
        }
    }

    size_t cursor = 0;
    for (int id = kPcSectorFirst; id <= kPcSectorLast; ++id) {
        auto it = active.find(id);
        if (it == active.end()) {
            if (error) { *error = "PC sector " + std::to_string(id) + " not found on commit"; }
            return false;
        }
        const SaveSection &s = *it->second;
        const size_t pay_start = s.offset + kSectorHeaderSize;
        if ((pay_start + kSectorPayloadSize) > buffer.size()) {
            if (error) { *error = "PC sector " + std::to_string(id) + " write out of bounds"; }
            return false;
        }

        std::copy(stream.begin() + static_cast<ptrdiff_t>(cursor),
                  stream.begin() + static_cast<ptrdiff_t>(cursor + kSectorPayloadSize),
                  buffer.begin() + static_cast<ptrdiff_t>(pay_start));
        cursor += kSectorPayloadSize;

        // Recompute checksum over first 0xFF4 bytes of the sector (header + payload).
        const uint16_t new_chk = ComputeSectionChecksumForSection(buffer, s);
        WriteU16Le(buffer.data() + s.offset, kFooterChecksumOffset, new_chk);
    }

    return true;
}

std::vector<PcMon> ParsePcBox(
    const std::vector<uint8_t> &stream,
    const int box,
    const std::unordered_map<int, std::string> &species_db
) {
    std::vector<PcMon> out;
    if ((box < 1) || (box > kPcStreamBoxCount)) { return out; }

    EnsurePartyStaticDataLoaded(nullptr);

    for (int slot = 1; slot <= kPcBoxSlotCount; ++slot) {
        if (!SlotInStreamBounds(stream, box, slot)) { break; }
        const uint8_t *mon = ConstSlot(stream, box, slot);
        if (!IsPcMonValid(mon)) { continue; }

        PcMon e{};
        e.box = box;
        e.slot = slot;
        e.pid = ReadU32Le(mon, kPcPidOff);
        e.otid = ReadU32Le(mon, kPcOtidOff);
        e.nickname = DecodeText(mon + kPcNickOff, 10);
        e.species_id = ReadU16Le(mon, kPcSpeciesOff);
        e.item_id = ReadU16Le(mon, kPcItemOff);
        e.ball_id = mon[kPcBallOff];
        e.exp = ReadU32Le(mon, kPcExpOff);
        e.nature_id = static_cast<uint8_t>(e.pid % 25U);
        e.nature_name = kNatureNames[e.nature_id];
        e.is_shiny = IsShinyFromOtidPid(e.otid, e.pid);
        e.hidden_ability = GetHaFlag(mon);
        e.current_ability_index = e.hidden_ability ? 2 : static_cast<int>(e.pid & 1U);
        e.gender = GenderFromPidAndSpecies(e.species_id, e.pid);

        const int growth_rate = GetSpeciesGrowthRate(static_cast<int>(e.species_id));
        const int effective_rate = (growth_rate >= 0) ? growth_rate : 0;
        e.level = static_cast<uint8_t>(CalcLevelFromExp(effective_rate, e.exp));

        e.ivs = ReadPcIvs(mon);
        e.evs = ReadPcEvs(mon);
        e.move_ids = ReadPcMoves(mon);
        e.move_pp_ups = ReadPcPpUps(mon);
        for (int i = 0; i < 4; ++i) {
            e.move_pp_max[static_cast<size_t>(i)] = static_cast<uint8_t>(std::clamp(
                CalcMaxMovePp(static_cast<int>(e.move_ids[static_cast<size_t>(i)]),
                              static_cast<int>(e.move_pp_ups[static_cast<size_t>(i)])),
                0, 255));
        }

        const auto sp_it = species_db.find(static_cast<int>(e.species_id));
        e.species_name = (sp_it == species_db.end()) ? "Unknown" : sp_it->second;

        out.push_back(e);
    }
    return out;
}

int CountPcBoxMons(const std::vector<uint8_t> &stream, const int box) {
    if ((box < 1) || (box > kPcStreamBoxCount)) { return 0; }
    int count = 0;
    for (int slot = 1; slot <= kPcBoxSlotCount; ++slot) {
        if (!SlotInStreamBounds(stream, box, slot)) { break; }
        if (IsPcMonValid(ConstSlot(stream, box, slot))) { ++count; }
    }
    return count;
}

bool UpdatePcMonNickname(std::vector<uint8_t> &stream, const int box, const int slot, const std::string &nickname, std::string *error) {
    if (!ValidatePcSlotArgs(stream, box, slot, error)) { return false; }
    uint8_t *mon = MutableSlot(stream, box, slot);
    if (!IsPcMonValid(mon)) {
        if (error) { *error = "slot is empty or invalid"; }
        return false;
    }
    EncodeText(nickname, mon + kPcNickOff, 10);
    return true;
}

bool UpdatePcMonSpecies(std::vector<uint8_t> &stream, const int box, const int slot, const uint16_t species_id, std::string *error) {
    if (!ValidatePcSlotArgs(stream, box, slot, error)) { return false; }
    uint8_t *mon = MutableSlot(stream, box, slot);
    if (!IsPcMonValid(mon)) {
        if (error) { *error = "slot is empty or invalid"; }
        return false;
    }
    WriteU16Le(mon, kPcSpeciesOff, species_id);
    return true;
}

bool UpdatePcMonItem(std::vector<uint8_t> &stream, const int box, const int slot, const uint16_t item_id, std::string *error) {
    if (!ValidatePcSlotArgs(stream, box, slot, error)) { return false; }
    uint8_t *mon = MutableSlot(stream, box, slot);
    if (!IsPcMonValid(mon)) {
        if (error) { *error = "slot is empty or invalid"; }
        return false;
    }
    WriteU16Le(mon, kPcItemOff, item_id);
    return true;
}

bool UpdatePcMonLevel(std::vector<uint8_t> &stream, const int box, const int slot, const int level, std::string *error) {
    if (!ValidatePcSlotArgs(stream, box, slot, error)) { return false; }
    uint8_t *mon = MutableSlot(stream, box, slot);
    if (!IsPcMonValid(mon)) {
        if (error) { *error = "slot is empty or invalid"; }
        return false;
    }
    const int clamped = std::clamp(level, 1, 100);
    const uint16_t species_id = ReadU16Le(mon, kPcSpeciesOff);
    EnsurePartyStaticDataLoaded(nullptr);
    int growth_rate = GetSpeciesGrowthRate(static_cast<int>(species_id));
    if (growth_rate < 0) { growth_rate = 0; }
    const uint32_t new_exp = GetExpForLevel(growth_rate, clamped);
    WriteU32Le(mon, kPcExpOff, std::max(1U, new_exp));
    return true;
}

bool UpdatePcMonIvs(std::vector<uint8_t> &stream, const int box, const int slot, const std::array<uint8_t, 6> &ivs, std::string *error) {
    if (!ValidatePcSlotArgs(stream, box, slot, error)) { return false; }
    uint8_t *mon = MutableSlot(stream, box, slot);
    if (!IsPcMonValid(mon)) {
        if (error) { *error = "slot is empty or invalid"; }
        return false;
    }
    WritePcIvs(mon, ivs);
    return true;
}

bool UpdatePcMonEvs(std::vector<uint8_t> &stream, const int box, const int slot, const std::array<uint8_t, 6> &evs, std::string *error) {
    if (!ValidatePcSlotArgs(stream, box, slot, error)) { return false; }
    uint8_t *mon = MutableSlot(stream, box, slot);
    if (!IsPcMonValid(mon)) {
        if (error) { *error = "slot is empty or invalid"; }
        return false;
    }
    WritePcEvs(mon, evs);
    return true;
}

bool UpdatePcMonMoves(
    std::vector<uint8_t> &stream, const int box, const int slot,
    const std::array<uint16_t, 4> &moves,
    const std::array<uint8_t, 4> *pp_ups,
    std::string *error
) {
    if (!ValidatePcSlotArgs(stream, box, slot, error)) { return false; }
    uint8_t *mon = MutableSlot(stream, box, slot);
    if (!IsPcMonValid(mon)) {
        if (error) { *error = "slot is empty or invalid"; }
        return false;
    }
    WritePcMoves(mon, moves);
    if (pp_ups != nullptr) {
        WritePcPpUps(mon, *pp_ups);
    } else {
        // Revalidate existing pp-ups against new moves.
        WritePcPpUps(mon, ReadPcPpUps(mon));
    }
    return true;
}

bool UpdatePcMonNature(std::vector<uint8_t> &stream, const int box, const int slot, const uint8_t nature_id, std::string *error) {
    if (!ValidatePcSlotArgs(stream, box, slot, error)) { return false; }
    uint8_t *mon = MutableSlot(stream, box, slot);
    if (!IsPcMonValid(mon)) {
        if (error) { *error = "slot is empty or invalid"; }
        return false;
    }
    SetPcNature(mon, static_cast<int>(nature_id % 25));
    return true;
}

bool UpdatePcMonShiny(std::vector<uint8_t> &stream, const int box, const int slot, const bool shiny, std::string *error) {
    if (!ValidatePcSlotArgs(stream, box, slot, error)) { return false; }
    uint8_t *mon = MutableSlot(stream, box, slot);
    if (!IsPcMonValid(mon)) {
        if (error) { *error = "slot is empty or invalid"; }
        return false;
    }
    SetPcShiny(mon, shiny);
    return true;
}

bool UpdatePcMonHiddenAbility(std::vector<uint8_t> &stream, const int box, const int slot, const bool hidden, std::string *error) {
    if (!ValidatePcSlotArgs(stream, box, slot, error)) { return false; }
    uint8_t *mon = MutableSlot(stream, box, slot);
    if (!IsPcMonValid(mon)) {
        if (error) { *error = "slot is empty or invalid"; }
        return false;
    }
    SetHaFlag(mon, hidden);
    return true;
}

// Set ability slot 0/1 (standard, modifies PID bit 0 while preserving nature) or 2 (hidden).
// Mirrors pc.py set_ability_slot.
bool UpdatePcMonAbilitySwitch(std::vector<uint8_t> &stream, const int box, const int slot, const int ability_index, std::string *error) {
    if ((ability_index < 0) || (ability_index > 2)) {
        if (error) { *error = "ability_index must be 0, 1, or 2"; }
        return false;
    }
    if (!ValidatePcSlotArgs(stream, box, slot, error)) { return false; }
    uint8_t *mon = MutableSlot(stream, box, slot);
    if (!IsPcMonValid(mon)) {
        if (error) { *error = "slot is empty or invalid"; }
        return false;
    }

    if (ability_index == 2) {
        SetHaFlag(mon, true);
        return true;
    }

    // Standard slot 0 or 1: clear HA flag, then walk PID to set PID bit 0 == ability_index
    // while preserving nature (pid % 25).
    SetHaFlag(mon, false);
    uint32_t pid = ReadU32Le(mon, kPcPidOff);
    const int target_nature = static_cast<int>(pid % 25U);
    const uint32_t target_bit = static_cast<uint32_t>(ability_index);
    for (int iter = 0; iter < 0x100000; ++iter) {
        const bool nature_ok = (static_cast<int>(pid % 25U) == target_nature);
        const bool bit_ok = ((pid & 1U) == target_bit);
        if (nature_ok && bit_ok) { break; }
        pid = (pid + 1U) & 0xFFFFFFFFU;
    }
    WriteU32Le(mon, kPcPidOff, pid);
    return true;
}

bool InsertPcMon(std::vector<uint8_t> &stream,
                 const int box, const int slot,
                 const uint16_t species_id,
                 const int level,
                 const std::string &nickname,
                 const uint32_t otid,
                 const std::string &ot_name,
                 const std::unordered_map<int, std::string> &species_db,
                 std::string *error)
{
    if (!ValidatePcSlotArgs(stream, box, slot, error)) { return false; }
    uint8_t *mon = MutableSlot(stream, box, slot);
    if (IsPcMonValid(mon)) {
        if (error) *error = "slot is occupied";
        return false;
    }
    if (species_id == 0 || species_id > kMaxValidSpecies) {
        if (error) *error = "invalid species_id";
        return false;
    }

    // Zero-fill the slot
    std::fill(mon, mon + kPcMonSize, 0);

    // PID: deterministic from species (matches backend formula)
    const uint32_t pid = static_cast<uint32_t>((static_cast<uint64_t>(species_id) * 2654435761ULL) & 0xFFFFFFFFULL);
    WriteU32Le(mon, kPcPidOff, pid);
    WriteU32Le(mon, kPcOtidOff, otid);

    // OT name (7 bytes, 0xFF-padded)
    EncodeText(ot_name.substr(0, 7), mon + 0x14, 7);

    // Nickname (10 bytes): use provided nickname or default to species name
    const std::string raw_nick = nickname.empty() ?
        [&]() -> std::string {
            auto it = species_db.find(static_cast<int>(species_id));
            return (it != species_db.end()) ? it->second : "Pokemon";
        }() : nickname;
    EncodeText(raw_nick.substr(0, 10), mon + kPcNickOff, 10);

    // Species
    WriteU16Le(mon, kPcSpeciesOff, species_id);
    mon[kPcBallOff] = 3;

    // EXP from level
    {
        const int target_level = std::max(1, std::min(100, level));
        int gr = GetSpeciesGrowthRate(static_cast<int>(species_id));
        if (gr < 0) gr = 0;
        const uint32_t exp = GetExpForLevel(gr, target_level);
        WriteU32Le(mon, kPcExpOff, std::max(1u, exp));
    }

    // All IVs = 31 (packed at kPcIvsOff: 5 bits each, 6 stats)
    {
        uint32_t iv_pack = 0;
        for (int s = 0; s < 6; ++s) { iv_pack |= (31u << (s * 5)); }
        WriteU32Le(mon, kPcIvsOff, iv_pack);
    }

    return true;
}

} // namespace puse::core

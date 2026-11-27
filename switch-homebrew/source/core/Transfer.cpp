#include <puse/core/Transfer.hpp>

#include <algorithm>
#include <array>
#include <cstring>

#include <puse/core/Binary.hpp>
#include <puse/core/GameProfile.hpp>
#include <puse/core/Party.hpp>
#include <puse/core/Pc.hpp>
#include <puse/core/SaveSections.hpp>

namespace puse::core {
namespace {

constexpr size_t kPartyRecordSize = profile::kStoragePartyRecordSize;
constexpr size_t kPcRecordSize = profile::kStoragePcRecordSize;

bool IsValidPcRecord(const uint8_t *pc_raw) {
    const uint16_t species_id = ReadU16Le(pc_raw, profile::kCodecsPcFieldsSpecies);
    const uint32_t exp = ReadU32Le(pc_raw, profile::kCodecsPcFieldsExp);
    return species_id != 0U &&
           static_cast<int>(species_id) <= profile::MaxSpeciesId() &&
           exp >= profile::kCodecsPcLegacyValidationMinExp &&
           exp <= profile::kCodecsPcLegacyValidationMaxExp;
}

bool ValidateExplicitBoxSlot(
    const int box,
    const int slot,
    const size_t stream_size,
    size_t *out_stream_off,
    std::string *error
) {
    const int box_count = profile::PcBoxCount();
    const int slots_per_box = static_cast<int>(profile::kStoragePcSlotsPerBox);
    if (box < 1 || box > box_count) {
        if (error) *error = "Invalid PC box";
        return false;
    }
    if (slot < 1 || slot > slots_per_box) {
        if (error) *error = "Invalid PC slot";
        return false;
    }
    const size_t stream_off = static_cast<size_t>((box - 1) * slots_per_box + (slot - 1)) * kPcRecordSize;
    if ((stream_off + kPcRecordSize) > stream_size) {
        if (error) *error = "PC slot out of bounds";
        return false;
    }
    if (out_stream_off) *out_stream_off = stream_off;
    return true;
}

} // namespace

bool PartyRawToPcRaw(
    const uint8_t *party_raw,
    const size_t party_len,
    std::array<uint8_t, 58> *out_pc,
    std::string *error
) {
    if (!party_raw || party_len != kPartyRecordSize || !out_pc) {
        if (error) *error = "Invalid party record width";
        return false;
    }

    std::array<uint8_t, 58> raw{};
    std::copy_n(party_raw + 0x00, 0x1C, raw.data() + 0x00);
    std::copy_n(party_raw + 0x20, 0x0B, raw.data() + 0x1C);

    uint64_t packed_moves = 0ULL;
    for (int i = 0; i < 4; ++i) {
        const uint64_t move_id = static_cast<uint64_t>(ReadU16Le(party_raw, 0x2C + static_cast<size_t>(i * 2)) & 0x3FFU);
        packed_moves |= move_id << (10 * i);
    }
    for (int i = 0; i < 5; ++i) {
        raw[0x27 + static_cast<size_t>(i)] = static_cast<uint8_t>((packed_moves >> (8 * i)) & 0xFFULL);
    }

    std::copy_n(party_raw + 0x38, 0x06, raw.data() + 0x2C);
    std::copy_n(party_raw + 0x44, 0x08, raw.data() + 0x32);

    *out_pc = raw;
    return true;
}

bool PcRawToPartyRaw(
    const uint8_t *pc_raw,
    const size_t pc_len,
    std::array<uint8_t, 100> *out_party,
    std::string *error
) {
    if (!pc_raw || pc_len != kPcRecordSize || !out_party) {
        if (error) *error = "Invalid PC record width";
        return false;
    }

    EnsurePartyStaticDataLoaded(nullptr);

    std::array<uint8_t, 100> raw{};
    std::copy_n(pc_raw + 0x00, 0x1C, raw.data() + 0x00);
    std::copy_n(pc_raw + 0x1C, 0x0B, raw.data() + 0x20);

    uint64_t packed_moves = 0ULL;
    for (int i = 0; i < 5; ++i) {
        packed_moves |= static_cast<uint64_t>(pc_raw[0x27 + static_cast<size_t>(i)]) << (8 * i);
    }
    const uint8_t pp_ups_byte = raw[0x28];
    for (int i = 0; i < 4; ++i) {
        const uint16_t move_id = static_cast<uint16_t>((packed_moves >> (10 * i)) & 0x3FFULL);
        WriteU16Le(raw.data(), 0x2C + static_cast<size_t>(i * 2), move_id);
        const int pp_up = static_cast<int>((pp_ups_byte >> (2 * i)) & 0x03U);
        const int max_pp = CalcMaxMovePp(static_cast<int>(move_id), pp_up);
        raw[0x34 + static_cast<size_t>(i)] = static_cast<uint8_t>(std::clamp(max_pp, 0, 255));
    }

    std::copy_n(pc_raw + 0x2C, 0x06, raw.data() + 0x38);
    std::copy_n(pc_raw + 0x32, 0x08, raw.data() + 0x44);

    const uint16_t species_id = ReadU16Le(raw.data(), 0x20);
    const uint32_t exp = ReadU32Le(raw.data(), 0x24);
    int growth_rate = GetSpeciesGrowthRate(static_cast<int>(species_id));
    if (growth_rate < 0) {
        growth_rate = 0;
    }
    const int level_max = static_cast<int>(profile::kRulesLevelMax);
    const int level = std::clamp(CalcLevelFromExp(growth_rate, exp), 1, level_max);
    raw[profile::kCodecsPartyFieldsLevelVisual] = static_cast<uint8_t>(level);
    raw[0x55] = 0xFFU;

    const uint32_t iv_packed = ReadU32Le(raw.data(), 0x48);
    const std::array<uint8_t, 6> ivs = {{
        static_cast<uint8_t>((iv_packed >> 0U) & 0x1FU),
        static_cast<uint8_t>((iv_packed >> 5U) & 0x1FU),
        static_cast<uint8_t>((iv_packed >> 10U) & 0x1FU),
        static_cast<uint8_t>((iv_packed >> 15U) & 0x1FU),
        static_cast<uint8_t>((iv_packed >> 20U) & 0x1FU),
        static_cast<uint8_t>((iv_packed >> 25U) & 0x1FU),
    }};
    const std::array<uint8_t, 6> evs = {{
        raw[0x38], raw[0x39], raw[0x3A], raw[0x3B], raw[0x3C], raw[0x3D],
    }};
    const uint8_t nature_id = static_cast<uint8_t>(ReadU32Le(raw.data(), 0x00) % 25U);
    const BattlePreview preview = CalculateBattlePreview(species_id, level, nature_id, ivs, evs);
    if (preview.available) {
        const uint16_t hp = static_cast<uint16_t>(std::max<int>(1, preview.stats[0]));
        WriteU16Le(raw.data(), profile::kCodecsPartyFieldsCurrHp, hp);
        WriteU16Le(raw.data(), profile::kCodecsPartyFieldsMaxHp, hp);
        WriteU16Le(raw.data(), profile::kCodecsPartyFieldsAtk, static_cast<uint16_t>(std::max<int>(1, preview.stats[1])));
        WriteU16Le(raw.data(), profile::kCodecsPartyFieldsDef, static_cast<uint16_t>(std::max<int>(1, preview.stats[2])));
        WriteU16Le(raw.data(), profile::kCodecsPartyFieldsSpe, static_cast<uint16_t>(std::max<int>(1, preview.stats[3])));
        WriteU16Le(raw.data(), profile::kCodecsPartyFieldsSpa, static_cast<uint16_t>(std::max<int>(1, preview.stats[4])));
        WriteU16Le(raw.data(), profile::kCodecsPartyFieldsSpd, static_cast<uint16_t>(std::max<int>(1, preview.stats[5])));
    }
    WriteU16Le(raw.data(), profile::kCodecsPartyFieldsChecksum, 0U);

    *out_party = raw;
    return true;
}

bool FindFirstEmptyPcSlot(
    const std::vector<uint8_t> &stream,
    const int box_filter,
    int *out_box,
    int *out_slot,
    std::string *error
) {
    const int box_count = profile::PcBoxCount();
    const int slots_per_box = static_cast<int>(profile::kStoragePcSlotsPerBox);
    int start_box = 1;
    int end_box = box_count;
    if (box_filter != 0) {
        if (box_filter < 1 || box_filter > box_count) {
            if (error) *error = "Invalid PC box";
            return false;
        }
        start_box = box_filter;
        end_box = box_filter;
    }

    for (int b = start_box; b <= end_box; ++b) {
        for (int s = 1; s <= slots_per_box; ++s) {
            const size_t off = static_cast<size_t>((b - 1) * slots_per_box + (s - 1)) * kPcRecordSize;
            if ((off + kPcRecordSize) > stream.size()) {
                break;
            }
            if (ReadU16Le(stream.data(), off + profile::kCodecsPcFieldsSpecies) == 0U) {
                if (out_box) *out_box = b;
                if (out_slot) *out_slot = s;
                return true;
            }
        }
    }

    if (error) *error = (box_filter != 0) ? "Target box is full" : "PC storage is full";
    return false;
}

bool TransferPartyPc(
    std::vector<uint8_t> &buffer,
    const TransferRequest &req,
    TransferResult *out,
    std::string *error
) {
    if (!profile::Supports("party") || !profile::Supports("pc")) {
        if (error) *error = "Transfer is not supported for this profile";
        return false;
    }

    const auto active_sections = ActiveUnboundSections(buffer);
    if (active_sections.empty()) {
        if (error) *error = "No intact save slot";
        return false;
    }
    const SaveSection *trainer_sec = nullptr;
    for (const auto &sec : active_sections) {
        if (sec.section_id == profile::kStoragePartySectionId) {
            trainer_sec = &sec;
            break;
        }
    }
    if (!trainer_sec || (trainer_sec->offset + kSectionSize) > buffer.size()) {
        if (error) *error = "Trainer section not found";
        return false;
    }

    std::string pc_err;
    std::vector<uint8_t> pc_stream = BuildPcStream(buffer, &pc_err);
    if (pc_stream.empty()) {
        if (error) *error = pc_err.empty() ? "PC sectors not found" : pc_err;
        return false;
    }

    const size_t trainer_off = trainer_sec->offset;
    const size_t count_off = profile::kStoragePartyCountOffset;
    const size_t party_start = profile::kStoragePartyStart;
    const int party_cap = static_cast<int>(profile::kStoragePartyCapacity);
    const int slots_per_box = static_cast<int>(profile::kStoragePcSlotsPerBox);

    const uint32_t party_count_u32 = ReadU32Le(buffer.data(), trainer_off + count_off);
    if (party_count_u32 > static_cast<uint32_t>(party_cap)) {
        if (error) *error = "Invalid party count";
        return false;
    }
    const int party_count = static_cast<int>(party_count_u32);

    if (req.mode == TransferMode::PartyToPc) {
        if (party_count <= 1) {
            if (error) *error = "Cannot move the last Pokemon out of your party";
            return false;
        }
        if (req.party_index < 0 || req.party_index >= party_count) {
            if (error) *error = "Party Pokemon not found";
            return false;
        }
        const size_t party_off = trainer_off + party_start + static_cast<size_t>(req.party_index) * kPartyRecordSize;
        if (ReadU16Le(buffer.data(), party_off + profile::kCodecsPartyFieldsDataStart) == 0U) {
            if (error) *error = "Party Pokemon not found";
            return false;
        }

        int target_box = req.box;
        int target_slot = req.slot;
        size_t stream_off = 0;

        if (req.box == 0) {
            if (req.slot != 0) {
                if (error) *error = "PC box is required when slot is specified";
                return false;
            }
            if (!FindFirstEmptyPcSlot(pc_stream, 0, &target_box, &target_slot, error)) {
                return false;
            }
            stream_off = static_cast<size_t>((target_box - 1) * slots_per_box + (target_slot - 1)) * kPcRecordSize;
        } else if (req.slot == 0) {
            if (!FindFirstEmptyPcSlot(pc_stream, req.box, &target_box, &target_slot, error)) {
                return false;
            }
            stream_off = static_cast<size_t>((target_box - 1) * slots_per_box + (target_slot - 1)) * kPcRecordSize;
        } else {
            if (!ValidateExplicitBoxSlot(req.box, req.slot, pc_stream.size(), &stream_off, error)) {
                return false;
            }
        }

        if (ReadU16Le(pc_stream.data(), stream_off + profile::kCodecsPcFieldsSpecies) != 0U) {
            if (error) *error = "Target PC slot is occupied";
            return false;
        }

        std::array<uint8_t, 58> next_pc{};
        if (!PartyRawToPcRaw(buffer.data() + party_off, kPartyRecordSize, &next_pc, error)) {
            return false;
        }

        std::copy(next_pc.begin(), next_pc.end(), pc_stream.begin() + static_cast<ptrdiff_t>(stream_off));
        for (int k = req.party_index; k < party_count - 1; ++k) {
            const size_t dst = trainer_off + party_start + static_cast<size_t>(k) * kPartyRecordSize;
            const size_t src = trainer_off + party_start + static_cast<size_t>(k + 1) * kPartyRecordSize;
            std::copy_n(buffer.data() + src, kPartyRecordSize, buffer.data() + dst);
        }
        const size_t tail_off = trainer_off + party_start + static_cast<size_t>(party_count - 1) * kPartyRecordSize;
        std::fill_n(buffer.data() + tail_off, kPartyRecordSize, 0U);
        const int new_count = party_count - 1;
        WriteU32Le(buffer.data(), trainer_off + count_off, static_cast<uint32_t>(new_count));
        if (!RecalculateSectionChecksum(buffer, trainer_off)) {
            if (error) *error = "Failed to refresh trainer checksum";
            return false;
        }
        if (!CommitPcStream(buffer, pc_stream, error)) {
            return false;
        }

        if (out) {
            out->mode = TransferMode::PartyToPc;
            out->party_index = req.party_index;
            out->box = target_box;
            out->slot = target_slot;
            out->party_count = new_count;
        }
        return true;
    }

    if (req.mode == TransferMode::PcToParty) {
        if (party_count >= party_cap) {
            if (error) *error = "Party is full";
            return false;
        }
        size_t stream_off = 0;
        if (!ValidateExplicitBoxSlot(req.box, req.slot, pc_stream.size(), &stream_off, error)) {
            return false;
        }
        const uint8_t *pc_raw = pc_stream.data() + stream_off;
        if (ReadU16Le(pc_raw, profile::kCodecsPcFieldsSpecies) == 0U) {
            if (error) *error = "Source PC slot is empty";
            return false;
        }
        if (!IsValidPcRecord(pc_raw)) {
            if (error) *error = "Source PC slot is invalid or unsupported";
            return false;
        }

        std::array<uint8_t, 100> next_party{};
        if (!PcRawToPartyRaw(pc_raw, kPcRecordSize, &next_party, error)) {
            return false;
        }

        const size_t dst_off = trainer_off + party_start + static_cast<size_t>(party_count) * kPartyRecordSize;
        std::copy(next_party.begin(), next_party.end(), buffer.begin() + static_cast<ptrdiff_t>(dst_off));
        const int new_count = party_count + 1;
        WriteU32Le(buffer.data(), trainer_off + count_off, static_cast<uint32_t>(new_count));
        if (!RecalculateSectionChecksum(buffer, trainer_off)) {
            if (error) *error = "Failed to refresh trainer checksum";
            return false;
        }
        std::fill_n(pc_stream.data() + stream_off, kPcRecordSize, 0U);
        if (!CommitPcStream(buffer, pc_stream, error)) {
            return false;
        }

        if (out) {
            out->mode = TransferMode::PcToParty;
            out->party_index = party_count;
            out->box = req.box;
            out->slot = req.slot;
            out->party_count = new_count;
        }
        return true;
    }

    if (req.mode == TransferMode::SwapPartyPc) {
        if (party_count <= 0) {
            if (error) *error = "Party is empty";
            return false;
        }
        if (req.party_index < 0 || req.party_index >= party_count) {
            if (error) *error = "Party Pokemon not found";
            return false;
        }
        size_t stream_off = 0;
        if (!ValidateExplicitBoxSlot(req.box, req.slot, pc_stream.size(), &stream_off, error)) {
            return false;
        }
        const size_t party_off = trainer_off + party_start + static_cast<size_t>(req.party_index) * kPartyRecordSize;
        const uint8_t *party_raw = buffer.data() + party_off;
        if (ReadU16Le(party_raw, profile::kCodecsPartyFieldsDataStart) == 0U) {
            if (error) *error = "Party Pokemon not found";
            return false;
        }
        const uint8_t *pc_raw = pc_stream.data() + stream_off;
        if (ReadU16Le(pc_raw, profile::kCodecsPcFieldsSpecies) == 0U) {
            if (error) *error = "Source PC slot is empty";
            return false;
        }
        if (!IsValidPcRecord(pc_raw)) {
            if (error) *error = "Source PC slot is invalid or unsupported";
            return false;
        }

        std::array<uint8_t, 58> next_pc{};
        std::array<uint8_t, 100> next_party{};
        if (!PartyRawToPcRaw(party_raw, kPartyRecordSize, &next_pc, error)) {
            return false;
        }
        if (!PcRawToPartyRaw(pc_raw, kPcRecordSize, &next_party, error)) {
            return false;
        }

        std::copy(next_party.begin(), next_party.end(), buffer.begin() + static_cast<ptrdiff_t>(party_off));
        if (!RecalculateSectionChecksum(buffer, trainer_off)) {
            if (error) *error = "Failed to refresh trainer checksum";
            return false;
        }
        std::copy(next_pc.begin(), next_pc.end(), pc_stream.begin() + static_cast<ptrdiff_t>(stream_off));
        if (!CommitPcStream(buffer, pc_stream, error)) {
            return false;
        }

        if (out) {
            out->mode = TransferMode::SwapPartyPc;
            out->party_index = req.party_index;
            out->box = req.box;
            out->slot = req.slot;
            out->party_count = party_count;
        }
        return true;
    }

    if (error) *error = "Invalid transfer mode";
    return false;
}

} // namespace puse::core

#include <puse/core/PokedexFlags.hpp>

#include <puse/core/SaveSections.hpp>
#include <puse/io/DataLoader.hpp>

namespace puse::core {
namespace {

const SaveSection *FindActiveTrainerSection(const std::vector<SaveSection> &sections) {
    const SaveSection *best = nullptr;
    for (const SaveSection &s : sections) {
        if (s.section_id != kPokedexFlagTrainerSectionId) { continue; }
        if ((best == nullptr) || (s.save_index > best->save_index)) {
            best = &s;
        }
    }
    return best;
}

uint16_t ResolveDexId(uint16_t species_id);

int DexBitIndex(const uint16_t species_id) {
    const auto dex_id = ResolveDexId(species_id);
    if (dex_id < 1U || dex_id > kMaxTrackedDexId) {
        return -1;
    }
    return static_cast<int>(dex_id) - 1;
}

uint16_t ResolveDexId(const uint16_t species_id) {
    static const auto mapping = puse::io::LoadIdNameFile(puse::io::ResolveAssetPath("data/pokedex_species_map.txt"));
    const auto it = mapping.find(static_cast<int>(species_id));
    return it == mapping.end() ? 0 : static_cast<uint16_t>(std::stoi(it->second));
}

bool ReadFlagAtOffset(const std::vector<uint8_t> &buffer, const uint32_t base_offset, const uint16_t species_id) {
    const int bit_index = DexBitIndex(species_id);
    if (bit_index < 0) { return false; }
    const uint32_t byte_index = static_cast<uint32_t>(bit_index) / 8U;
    if (byte_index >= kPokedexFlagByteCount) { return false; }

    const std::vector<SaveSection> sections = ListSections(buffer);
    const SaveSection *section = FindActiveTrainerSection(sections);
    if (section == nullptr) { return false; }

    const size_t abs = section->offset + base_offset + byte_index;
    if (abs >= buffer.size()) { return false; }
    return ((buffer[abs] >> (static_cast<uint32_t>(bit_index) % 8U)) & 1U) == 1U;
}

bool WriteFlagAtOffset(std::vector<uint8_t> &buffer, const uint32_t base_offset, const uint16_t species_id, const bool value) {
    const int bit_index = DexBitIndex(species_id);
    if (bit_index < 0) { return false; }
    const uint32_t byte_index = static_cast<uint32_t>(bit_index) / 8U;
    if (byte_index >= kPokedexFlagByteCount) { return false; }

    const std::vector<SaveSection> sections = ListSections(buffer);
    const SaveSection *section = FindActiveTrainerSection(sections);
    if (section == nullptr) { return false; }

    const size_t abs = section->offset + base_offset + byte_index;
    if (abs >= buffer.size()) { return false; }

    const uint8_t mask = static_cast<uint8_t>(1U << (static_cast<uint32_t>(bit_index) % 8U));
    buffer[abs] = value ? static_cast<uint8_t>(buffer[abs] | mask) : static_cast<uint8_t>(buffer[abs] & ~mask);
    return RecalculateSectionChecksum(buffer, section->offset);
}

} // namespace

uint16_t DexIdForSpecies(const uint16_t species_id) {
    return ResolveDexId(species_id);
}

bool IsDexSpeciesTrackable(const uint16_t species_id) {
    const uint16_t dex_id = ResolveDexId(species_id);
    return dex_id >= 1U && dex_id <= kMaxTrackedDexId;
}

PokedexFlags GetPokedexFlags(const std::vector<uint8_t> &buffer, const uint16_t species_id) {
    PokedexFlags flags{};
    flags.trackable = IsDexSpeciesTrackable(species_id);
    if (!flags.trackable) {
        return flags;
    }
    flags.seen = ReadFlagAtOffset(buffer, kPokedexSeenOffset, species_id);
    flags.caught = ReadFlagAtOffset(buffer, kPokedexCaughtOffset, species_id);
    return flags;
}

bool SetPokedexFlag(std::vector<uint8_t> &buffer, const uint16_t species_id, const std::string &flag, const bool value, PokedexFlags *out) {
    const bool caught = flag == "caught";
    const uint32_t offset = caught ? kPokedexCaughtOffset : kPokedexSeenOffset;
    if (!WriteFlagAtOffset(buffer, offset, species_id, value)) {
        return false;
    }
    if (value && caught) {
        WriteFlagAtOffset(buffer, kPokedexSeenOffset, species_id, true);
    }
    if (out != nullptr) {
        *out = GetPokedexFlags(buffer, species_id);
    }
    return true;
}

} // namespace puse::core

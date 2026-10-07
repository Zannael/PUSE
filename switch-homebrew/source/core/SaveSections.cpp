#include <puse/core/SaveSections.hpp>

#include <puse/core/Binary.hpp>
#include <array>

namespace puse::core {

size_t UnboundChecksumLength(uint16_t id) {
    return id == 0 ? 0xF24 : id == 4 ? 0xD98 : id == 13 ? 0x450 : 0xFF0;
}

std::vector<SaveSection> ActiveUnboundSections(const std::vector<uint8_t>& buffer, bool verify_checksums) {
    std::vector<std::vector<SaveSection>> slots;
    const auto sections = ListSections(buffer);
    for (size_t base : {size_t(0), size_t(14)}) {
        if (sections.size() < base + 14) continue;
        std::vector<SaveSection> slot(14);
        bool valid = true;
        std::array<bool, 14> seen{};
        const auto counter = sections[base].save_index;
        for (size_t i = base; i < base + 14; ++i) {
            const auto& sec = sections[i];
            const auto signature = ReadU32Le(buffer.data() + sec.offset, 0xFF8);
            if (sec.section_id > 13 || seen[sec.section_id] || sec.save_index != counter ||
                (signature != 0x01121999 && signature != 0x01121998)) {
                valid = false; break;
            }
            // Retain section 4's opaque checksum protection.
            if (verify_checksums && sec.section_id != 4 && ComputeSectionChecksum(buffer.data() + sec.offset,
                    UnboundChecksumLength(sec.section_id), 0) != sec.stored_checksum) {
                valid = false; break;
            }
            seen[sec.section_id] = true;
            slot[sec.section_id] = sec;
        }
        if (valid) slots.push_back(slot);
    }
    if (slots.empty()) return {};
    if (slots.size() == 2) {
        const uint32_t delta = slots[1][0].save_index - slots[0][0].save_index;
        if (delta > 0 && delta < 0x80000000U) return slots[1];
    }
    return slots[0];
}

uint16_t ComputeSectionChecksum(const uint8_t *payload, const size_t payload_len, const uint32_t valid_len) {
    size_t used_len = payload_len;
    if ((valid_len > 0) && (valid_len <= payload_len)) {
        used_len = static_cast<size_t>(valid_len);
    }

    const size_t pad = (4 - (used_len % 4)) % 4;
    uint32_t total = 0;

    size_t off = 0;
    while ((off + 4) <= used_len) {
        total = (total + ReadU32Le(payload, off)) & 0xFFFFFFFFU;
        off += 4;
    }

    if (off < used_len) {
        uint8_t tail[4] = {0, 0, 0, 0};
        for (size_t i = off; i < used_len; ++i) {
            tail[i - off] = payload[i];
        }
        total = (total + ReadU32Le(tail, 0)) & 0xFFFFFFFFU;
    } else if (pad != 0) {
        (void)pad;
    }

    const uint16_t lower = static_cast<uint16_t>(total & 0xFFFFU);
    const uint16_t upper = static_cast<uint16_t>((total >> 16U) & 0xFFFFU);
    return static_cast<uint16_t>((lower + upper) & 0xFFFFU);
}

std::vector<SaveSection> ListSections(const std::vector<uint8_t> &buffer) {
    std::vector<SaveSection> out;
    if (buffer.size() < kSectionSize) {
        return out;
    }

    const size_t section_count = buffer.size() / kSectionSize;
    out.reserve(section_count);

    for (size_t i = 0; i < section_count; ++i) {
        const size_t off = i * kSectionSize;
        const uint8_t *sec = &buffer[off];

        SaveSection s{};
        s.index = i;
        s.offset = off;
        s.section_id = ReadU16Le(sec, kFooterIdOffset);
        s.valid_len = ReadU32Le(sec, kFooterValidLenOffset);
        s.stored_checksum = ReadU16Le(sec, kFooterChecksumOffset);
        s.save_index = ReadU32Le(sec, kFooterSaveIndexOffset);
        out.push_back(s);
    }

    return out;
}

uint16_t ComputeSectionChecksumForSection(const std::vector<uint8_t> &buffer, const SaveSection &section) {
    if ((section.offset + kSectionSize) > buffer.size()) {
        return 0;
    }
    const uint8_t *sec = &buffer[section.offset];
    return ComputeSectionChecksum(sec, UnboundChecksumLength(section.section_id), 0);
}

bool IsSectionChecksumValid(const std::vector<uint8_t> &buffer, const SaveSection &section) {
    return ComputeSectionChecksumForSection(buffer, section) == section.stored_checksum;
}

bool RecalculateSectionChecksum(std::vector<uint8_t> &buffer, const size_t section_offset) {
    // Auxiliary sectors do not have ordinary section checksums.
    if (section_offset >= 28 * kSectionSize) return true;
    if ((section_offset + kSectionSize) > buffer.size()) {
        return false;
    }

    const uint16_t id = ReadU16Le(&buffer[section_offset], kFooterIdOffset);
    if (id == 4) return true;
    const uint16_t checksum = ComputeSectionChecksum(&buffer[section_offset], UnboundChecksumLength(id), 0);
    WriteU16Le(&buffer[section_offset], kFooterChecksumOffset, checksum);
    return true;
}

} // namespace puse::core

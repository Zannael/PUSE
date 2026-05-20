#include <puse/core/SaveSections.hpp>

#include <puse/core/Binary.hpp>

namespace puse::core {

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
    return ComputeSectionChecksum(sec, kFooterIdOffset, section.valid_len);
}

bool IsSectionChecksumValid(const std::vector<uint8_t> &buffer, const SaveSection &section) {
    return ComputeSectionChecksumForSection(buffer, section) == section.stored_checksum;
}

} // namespace puse::core

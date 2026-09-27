#include <puse/core/SaveHealth.hpp>

#include <puse/core/SaveSections.hpp>

#include <array>
#include <algorithm>
#include <utility>

namespace puse::core {
namespace {

std::string PcField(const std::string &prefix, const size_t inside) {
    struct Range { size_t start; size_t end; const char *label; };
    static constexpr Range fields[] = {
        {0x00, 0x04, "PID"}, {0x04, 0x08, "owner ID"}, {0x08, 0x12, "nickname"},
        {0x1C, 0x1E, "species"}, {0x1E, 0x20, "held item"}, {0x20, 0x24, "EXP"},
        {0x24, 0x25, "PP Ups"}, {0x26, 0x27, "caught ball"}, {0x27, 0x2C, "moves"},
        {0x2C, 0x32, "EVs"}, {0x36, 0x3A, "IVs/ability flag"},
    };
    for (const auto &field : fields) {
        if (inside >= field.start && inside < field.end) return prefix + " " + field.label;
    }
    return prefix + " data";
}

std::string FieldLabel(const int id, const size_t offset) {
    if (id == 1) {
        if (offset >= 0x34 && offset < 0x38) return "Party count";
        if (offset >= 0x38 && offset < 0x38 + 6 * 100) {
            const size_t slot = (offset - 0x38) / 100 + 1;
            const size_t inside = (offset - 0x38) % 100;
            if (inside >= 0x08 && inside < 0x12) return "Party " + std::to_string(slot) + " nickname";
            if (inside == 0x54) return "Party " + std::to_string(slot) + " level";
            return "Party " + std::to_string(slot) + " data";
        }
        return "Trainer data";
    }
    if (id == 0 && offset >= 0xB0 && offset < 0xB0 + 30 * 58) {
        const size_t relative = offset - 0xB0;
        return PcField("Preset slot " + std::to_string(relative / 58 + 1), relative % 58);
    }
    if (id >= 5 && id <= 12 && offset >= 4 && offset < 0xFF4) {
        const size_t relative = static_cast<size_t>(id - 5) * 0xFF0 + (offset - 4);
        const size_t mon_index = relative / 58;
        if (mon_index < 18 * 30)
            return PcField("Box " + std::to_string(mon_index / 30 + 1) + " slot " + std::to_string(mon_index % 30 + 1), relative % 58);
        return "PC storage";
    }
    if (id >= 13 && id <= 16) return "Bag data";
    if (id == 4 && offset >= 0xF34 && offset < 0xF36) return "Battle Points";
    return "Section data";
}

int ByteAt(const std::vector<uint8_t> &buffer, const size_t offset) {
    return offset < buffer.size() ? static_cast<int>(buffer[offset]) : -1;
}

} // namespace

SaveHealthReport BuildSaveHealthReportImpl(const std::vector<uint8_t> &original, const std::vector<uint8_t> &current, const bool include_source) {
    const auto sections = ListSections(current);
    SaveHealthReport report{};
    report.size = current.size();
    report.section_count = sections.size();
    report.trailing_bytes = current.size() % kSectionSize;

    std::array<int, 14> active{};
    active.fill(-1);
    for (size_t index = 0; index < sections.size(); ++index) {
        const auto &sec = sections[index];
        if (sec.section_id >= active.size() || sec.save_index == 0) continue;
        int &previous = active[sec.section_id];
        if (previous < 0 || sec.save_index > sections[static_cast<size_t>(previous)].save_index)
            previous = static_cast<int>(index);
    }
    if (current.size() < 28 * kSectionSize) report.warning_codes.push_back("short_save");
    if (original.size() != current.size()) report.warning_codes.push_back("size_changed");
    for (int id = 0; id < 14; ++id) {
        if (active[static_cast<size_t>(id)] < 0) report.missing_ids.push_back(id);
    }
    if (!report.missing_ids.empty()) report.warning_codes.push_back("missing_sections");

    for (int id = 0; id < 14; ++id) {
        const int active_index = active[static_cast<size_t>(id)];
        if (active_index < 0) continue;
        const auto &sec = sections[static_cast<size_t>(active_index)];
        report.active_save_index = std::max(report.active_save_index, sec.save_index);
        if (id == 4) {
            report.checksums.push_back({id, sec.index, "opaque", sec.stored_checksum, 0, false});
            continue;
        }
        uint32_t length = id == 0 ? 0xADC : id == 13 ? 0x450 : sec.valid_len;
        if (length == 0 || length > 0xFF4) length = 0xFF4;
        const uint16_t computed = ComputeSectionChecksum(current.data() + sec.offset, 0xFF4, length);
        const bool ok = computed == sec.stored_checksum;
        report.checksums.push_back({id, sec.index, ok ? "ok" : "mismatch", sec.stored_checksum, computed, true});
        if (!ok) report.warning_codes.push_back("checksum_mismatch");
    }

    const size_t total_sections = std::max(original.size(), current.size()) / kSectionSize;
    for (size_t index = 0; index < total_sections; ++index) {
        HealthSector changed{};
        changed.index = index;
        changed.id = index < sections.size() ? static_cast<int>(sections[index].section_id) : -1;
        changed.save_index = index < sections.size() ? sections[index].save_index : 0;
        const size_t base = index * kSectionSize;
        for (size_t inside = 0; inside < kSectionSize; ++inside) {
            if (ByteAt(original, base + inside) == ByteAt(current, base + inside)) continue;
            ++report.changed_bytes;
            if (inside >= 0xFF0) {
                ++changed.footer_bytes;
            } else {
                ++changed.payload_bytes;
                const auto label = FieldLabel(changed.id, inside);
                auto field = std::find_if(changed.fields.begin(), changed.fields.end(),
                    [&](const HealthField &entry) { return entry.name == label; });
                if (field == changed.fields.end()) changed.fields.push_back({label, 1});
                else ++field->changed_bytes;
            }
        }
        if (changed.payload_bytes || changed.footer_bytes) report.sectors.push_back(std::move(changed));
    }
    for (size_t offset = total_sections * kSectionSize; offset < std::max(original.size(), current.size()); ++offset)
        report.changed_bytes += ByteAt(original, offset) != ByteAt(current, offset);
    if (include_source) report.original_warning_codes = BuildSaveHealthReportImpl(original, original, false).warning_codes;
    return report;
}

SaveHealthReport BuildSaveHealthReport(const std::vector<uint8_t> &original, const std::vector<uint8_t> &current) {
    return BuildSaveHealthReportImpl(original, current, true);
}

} // namespace puse::core

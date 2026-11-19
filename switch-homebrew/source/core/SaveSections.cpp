#include <puse/core/SaveSections.hpp>

#include <puse/core/Binary.hpp>
#include <array>
#include <algorithm>

namespace puse::core {

std::vector<const profile::GameProfile*> RecognizeProfiles(const std::vector<uint8_t>& buffer) {
    std::vector<const profile::GameProfile*> result;
    for (const auto* game : {&profile::kBuiltin, &profile::kRadicalRed}) {
        for (size_t base : {size_t(0), size_t(14*4096)}) {
            if (base+14*4096 > buffer.size()) continue;
            std::array<bool,14> seen{}; bool valid=true;
            const auto counter=ReadU32Le(buffer.data()+base,kFooterSaveIndexOffset);
            for(size_t i=0;i<14;i++) {
                const auto* bytes=buffer.data()+base+i*4096;
                const auto id=ReadU16Le(bytes,kFooterIdOffset);
                const auto sig=ReadU32Le(bytes,0xFF8);
                const bool signature=game==&profile::kRadicalRed ? sig==0x08012025 : sig==0x01121999 || sig==0x01121998;
                if(id>=14 || seen[id] || !signature || ReadU32Le(bytes,kFooterSaveIndexOffset)!=counter) {valid=false;break;}
                seen[id]=true;
            }
            if(valid) {result.push_back(game);break;}
        }
    }
    return result;
}

CompatibilityReport BuildCompatibilityReport(const std::vector<uint8_t>& buffer, const std::string& requested) {
    CompatibilityReport report;
    report.size = buffer.size();
    const auto candidates = RecognizeProfiles(buffer);
    for (const auto* p: candidates) report.candidates.push_back(p->id);
    const auto* selected = profile::FindProfile(requested);
    if (requested.empty() && candidates.size() == 1) selected = candidates[0];
    if (!requested.empty() && !selected) report.blockers.push_back("unsupported_profile");
    else if (!selected || std::find(candidates.begin(), candidates.end(), selected) == candidates.end()) report.blockers.push_back("unknown_layout");
    if (selected) {
        report.profile_id = selected->id;
        if (buffer.size() != profile::kContainerFlashSize && buffer.size() != profile::kContainerFlashSize + 16) report.blockers.push_back("unsupported_size");
        const auto structural = ActiveUnboundSections(buffer, false, selected);
        const auto editable = ActiveUnboundSections(buffer, true, selected);
        if (!structural.empty()) report.structural_generation = structural[0].save_index;
        if (!editable.empty()) report.editable_generation = editable[0].save_index;
        report.uses_older_generation = !structural.empty() && !editable.empty() && structural[0].offset != editable[0].offset;
        if (selected == &profile::kBuiltin) report.opaque_section_ids.push_back(4);
        if (editable.empty()) report.blockers.push_back("no_coherent_generation");
        if (requested.empty() && selected != &profile::kBuiltin) report.blockers.push_back("explicit_selection_required");
    }
    report.mutations_allowed = report.blockers.empty();
    return report;
}

std::string CompatibilityReportJson(const CompatibilityReport& r) {
    // Profile IDs and blocker codes come only from the built-in registry.
    std::string out = "{\"schema_version\":1,\"size\":" + std::to_string(r.size) + ",\"profile_id\":" +
        (r.profile_id.empty() ? "null" : "\"" + r.profile_id + "\"") + ",\"candidates\":[";
    for (size_t i = 0; i < r.candidates.size(); ++i) out += (i ? "," : "") + std::string("\"") + r.candidates[i] + "\"";
    out += "],\"exact_rom_version_confirmed\":false,\"structural_generation\":" + (r.structural_generation < 0 ? "null" : std::to_string(r.structural_generation));
    out += ",\"editable_generation\":" + (r.editable_generation < 0 ? "null" : std::to_string(r.editable_generation));
    out += ",\"uses_older_generation\":" + std::string(r.uses_older_generation ? "true" : "false") + ",\"opaque_section_ids\":[";
    for (size_t i = 0; i < r.opaque_section_ids.size(); ++i) out += (i ? "," : "") + std::to_string(r.opaque_section_ids[i]);
    out += "],\"mutations_allowed\":" + std::string(r.mutations_allowed ? "true" : "false") + ",\"blockers\":[";
    for (size_t i = 0; i < r.blockers.size(); ++i) out += (i ? "," : "") + std::string("\"") + r.blockers[i] + "\"";
    return out + "]}";
}

std::vector<std::string> CompatibilityDetails(const CompatibilityReport& r) {
    std::vector<std::string> lines = {
        "Profile: " + (r.profile_id.empty() ? std::string("unknown") : r.profile_id),
        "Size: " + std::to_string(r.size) + " bytes",
        "ROM version: user declared, unconfirmed",
        "Generation: " + (r.editable_generation < 0 ? std::string("none intact") : std::to_string(r.editable_generation)),
        r.uses_older_generation ? "Fallback: older intact generation" : "Fallback: not used",
        r.mutations_allowed ? "Editing: permitted for declared game" : "Editing: blocked"
    };
    for (const auto& code: r.blockers) lines.push_back(code);
    if (!r.opaque_section_ids.empty()) lines.push_back("Section 4 checksum: unverified");
    return lines;
}

bool ChooseProfile(const std::vector<uint8_t>& buffer, const std::string& requested, const profile::GameProfile** out, std::string* error) {
    const auto report = BuildCompatibilityReport(buffer, requested);
    if (!report.mutations_allowed) {
        if (error) {
            *error = "Unsupported save layout";
            for (const auto& code: report.blockers) {
                if (code == "explicit_selection_required") *error = "Explicit game/version selection required";
            }
            for (const auto& line: CompatibilityDetails(report)) *error += "\n" + line;
        }
        return false;
    }
    if (out) *out = profile::FindProfile(report.profile_id);
    return true;
}

size_t UnboundChecksumLength(uint16_t id) {
    return profile::ChecksumLength(id);
}

std::vector<SaveSection> ActiveUnboundSections(const std::vector<uint8_t>& buffer, bool verify_checksums, const profile::GameProfile* game) {
    if (!game) game = &profile::Current();
    const bool radical = game == &profile::kRadicalRed;
    std::vector<std::vector<SaveSection>> slots;
    const auto sections = ListSections(buffer);
    for (size_t slot_index = 0; slot_index < profile::kContainerSlotCount; ++slot_index) {
        const size_t base = slot_index * profile::kContainerSectionsPerSlot;
        if (sections.size() < base + profile::kContainerSectionsPerSlot) continue;
        std::vector<SaveSection> slot(profile::kContainerSectionsPerSlot);
        bool valid = true;
        std::array<bool, profile::kContainerSectionsPerSlot> seen{};
        const auto counter = sections[base].save_index;
        for (size_t i = base; i < base + profile::kContainerSectionsPerSlot; ++i) {
            const auto& sec = sections[i];
            const auto signature = ReadU32Le(buffer.data() + sec.offset, profile::kContainerFooterSignature);
            if (sec.section_id >= profile::kContainerSectionsPerSlot || seen[sec.section_id] || sec.save_index != counter ||
                !(radical ? signature == 0x08012025 : signature == 0x01121999 || signature == 0x01121998)) {
                valid = false; break;
            }
            // Retain section 4's opaque checksum protection.
            if (verify_checksums && (radical || sec.section_id != 4) && ComputeSectionChecksum(buffer.data() + sec.offset,
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
    if (section_offset >= profile::kContainerSlotCount * profile::kContainerSectionsPerSlot * kSectionSize) return true;
    if ((section_offset + kSectionSize) > buffer.size()) {
        return false;
    }

    const uint16_t id = ReadU16Le(&buffer[section_offset], kFooterIdOffset);
    if (profile::Opaque(id)) return true;
    const uint16_t checksum = ComputeSectionChecksum(&buffer[section_offset], UnboundChecksumLength(id), 0);
    WriteU16Le(&buffer[section_offset], kFooterChecksumOffset, checksum);
    return true;
}

} // namespace puse::core

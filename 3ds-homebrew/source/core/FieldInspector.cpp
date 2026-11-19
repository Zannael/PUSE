#include <puse/core/FieldInspector.hpp>
#include <puse/core/SaveSections.hpp>
#include <puse/core/Party.hpp>
#include <iomanip>
#include <map>
#include <sstream>

namespace puse::core {
namespace {
std::string Hex(size_t value) {
    std::ostringstream out; out << "0x" << std::hex << value; return out.str();
}
std::string Quote(const std::string& text) {
    std::ostringstream out; out << '"';
    for (const unsigned char ch: text) {
        if (ch == '"' || ch == '\\') out << '\\' << ch;
        else if (ch < 32) out << "\\u" << std::hex << std::setw(4) << std::setfill('0') << int(ch);
        else out << ch;
    }
    out << '"'; return out.str();
}
}
bool BuildFieldReport(const std::vector<uint8_t>& buffer, FieldReport* out, std::string* error) {
    const auto active = ActiveUnboundSections(buffer);
    if (!out || active.size() != 14) {
        if (error) *error = "No coherent save generation for the selected profile";
        return false;
    }
    std::map<uint16_t, SaveSection> sections;
    for (const auto& sec: active) sections.emplace(sec.section_id, sec);
    FieldReport report; report.profile_id = profile::Current().id;
    report.save_index = sections.at(0).save_index;
    auto add = [&](const std::string& id, const std::string& label, uint16_t sid, size_t relative,
                   size_t width, int bit = -1, const std::string& decoded = "", const std::string& confidence = "verified-layout") {
        const size_t offset = sections.at(sid).offset + relative;
        std::ostringstream raw;
        uint32_t value = 0;
        for (size_t i = 0; i < width; ++i) {
            raw << std::hex << std::setw(2) << std::setfill('0') << int(buffer[offset + i]);
            if (i < 4) value |= uint32_t(buffer[offset + i]) << (8 * i);
        }
        const std::string text = !decoded.empty() ? decoded : bit >= 0 ? ((value & (1U << bit)) ? "true" : "false") : std::to_string(value);
        report.fields.push_back({id, label, sid, relative, offset, width, bit, raw.str(), text, confidence});
    };
    TrainerIdentity trainer{};
    if (!ReadTrainerIdentity(buffer, &trainer)) return false;
    add("trainer.name", "Trainer name", 0, 0, 7);
    report.fields.back().decoded = trainer.name; // Empty names are valid read-only evidence.
    add("trainer.gender", "Trainer gender byte (unclassified enum)", 0, 8, 1, -1, "", "layout-only");
    add("trainer.tid", "Trainer ID", 0, 0xA, 2);
    add("trainer.sid", "Secret ID", 0, 0xC, 2);
    add("party.count", "Stored party count", profile::kStoragePartySectionId, profile::kStoragePartyCountOffset, 4);
    uint32_t key = 0;
    if (profile::IsRadicalRed()) {
        add("money.key", "Money XOR key", 0, 0xF20, 4);
        key = static_cast<uint32_t>(std::stoul(report.fields.back().decoded));
    }
    add("money.value", "Stored money (decoded)", profile::kStorageResourcesTrainerSectionId, profile::kStorageResourcesMoneyOffset, 4);
    report.fields.back().decoded = std::to_string(static_cast<uint32_t>(std::stoul(report.fields.back().decoded)) ^ key);
    if (!profile::IsRadicalRed()) {
        auto flag = [&](int value, const std::string& id, const std::string& label) {
            uint16_t sid = value >= 0x900 ? 4 : 1;
            size_t relative = value >= 0x900 ? 0xD98 + (value - 0x900) / 8 : 0xEE0 + value / 8;
            while (relative >= 0xFF0) { ++sid; relative -= 0xFF0; }
            add(id, label, sid, relative, 1, value % 8);
        };
        for (int n = 0; n < 8; ++n) flag(0x820 + n, "badge." + std::to_string(n + 1), "Badge " + std::to_string(n + 1));
        flag(0x82C, "progress.champion", "Champion");
        flag(0x91E, "progress.dexnav", "DexNav");
    }
    *out = std::move(report);
    return true;
}
std::string FieldReportJson(const FieldReport& report) {
    std::ostringstream out;
    out << "{\"schema_version\":1,\"profile_id\":" << Quote(report.profile_id)
        << ",\"read_only\":true,\"exact_rom_version_confirmed\":false,\"notice\":" << Quote(kFieldInspectorNotice)
        << ",\"save_index\":" << report.save_index << ",\"fields\":[";
    bool first = true;
    for (const auto& field: report.fields) {
        if (!first) out << ',';
        first = false;
        out << "{\"id\":" << Quote(field.id) << ",\"label\":" << Quote(field.label)
            << ",\"section_id\":" << field.section_id << ",\"relative_offset\":" << field.relative_offset
            << ",\"file_offset\":" << field.file_offset << ",\"width\":" << field.width << ",\"bit\":";
        if (field.bit < 0) out << "null"; else out << field.bit;
        out << ",\"raw_hex\":" << Quote(field.raw_hex) << ",\"decoded\":" << Quote(field.decoded)
            << ",\"confidence\":" << Quote(field.confidence) << '}';
    }
    out << "]}"; return out.str();
}
std::vector<std::string> FieldDetails(const InspectedField& field) {
    return {field.label, "Value: " + field.decoded, "Section " + std::to_string(field.section_id) + " + " + Hex(field.relative_offset),
            "File: " + Hex(field.file_offset) + " / " + std::to_string(field.width) + " bytes",
            "Raw: " + field.raw_hex + (field.bit < 0 ? "" : " / bit " + std::to_string(field.bit)),
            "Confidence: " + field.confidence};
}
} // namespace puse::core

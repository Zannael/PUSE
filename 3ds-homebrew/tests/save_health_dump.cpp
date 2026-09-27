#include <puse/core/SaveHealth.hpp>

#include <fstream>
#include <iostream>
#include <iterator>
#include <string>
#include <vector>

static std::vector<uint8_t> ReadFile(const char *path) {
    std::ifstream input(path, std::ios::binary);
    return {std::istreambuf_iterator<char>(input), std::istreambuf_iterator<char>()};
}

int main(int argc, char **argv) {
    if (argc != 4) return 2;
    const auto original = ReadFile(argv[1]);
    const auto current = ReadFile(argv[2]);
    if (original.empty() || current.empty()) return 3;
    const auto report = puse::core::BuildSaveHealthReport(original, current);
    std::cout << "case " << argv[3] << '\n';
    std::cout << "layout " << report.size << ' ' << report.section_count << ' ' << report.trailing_bytes << ' ' << report.active_save_index << ' ';
    for (size_t i = 0; i < report.missing_ids.size(); ++i) {
        if (i) std::cout << ',';
        std::cout << report.missing_ids[i];
    }
    std::cout << '\n';
    for (const auto &row : report.checksums) {
        std::cout << "checksum " << row.id << ' ' << row.index << ' ' << row.status << ' ' << row.stored << ' ';
        if (row.has_computed) std::cout << row.computed;
        else std::cout << '-';
        std::cout << '\n';
    }
    for (const auto &code : report.warning_codes) std::cout << "warning " << code << '\n';
    for (const auto &code : report.original_warning_codes) std::cout << "source_warning " << code << '\n';
    std::cout << "changes " << report.changed_bytes << '\n';
    for (const auto &sector : report.sectors) {
        std::cout << "sector " << sector.index << ' ' << sector.id << ' ' << sector.save_index << ' ' << sector.payload_bytes << ' ' << sector.footer_bytes << '\n';
        for (const auto &field : sector.fields) std::cout << "field " << field.name << ' ' << field.changed_bytes << '\n';
    }
}

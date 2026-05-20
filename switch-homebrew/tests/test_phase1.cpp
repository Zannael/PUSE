#include <iostream>
#include <string>

#include <puse/core/SaveSession.hpp>

int main(int argc, char **argv) {
    if (argc < 2) {
        std::cerr << "Usage: test_phase1 <save_file>" << std::endl;
        return 1;
    }

    puse::core::SaveSession session;
    std::string error;
    if (!session.LoadFromFile(argv[1], &error)) {
        std::cerr << "load failed: " << error << std::endl;
        return 2;
    }

    const auto sections = session.Sections();
    if (sections.empty()) {
        std::cerr << "no sections parsed" << std::endl;
        return 3;
    }

    size_t trainer_sections = 0;
    size_t checksum_ok = 0;
    for (const auto &sec : sections) {
        if (sec.section_id == 1) {
            ++trainer_sections;
        }
        if (puse::core::IsSectionChecksumValid(session.Buffer(), sec)) {
            ++checksum_ok;
        }
    }

    std::cout << "loaded=" << session.FileName() << '\n';
    std::cout << "size=" << session.Buffer().size() << '\n';
    std::cout << "sections=" << sections.size() << '\n';
    std::cout << "trainer_sections=" << trainer_sections << '\n';
    std::cout << "checksum_ok=" << checksum_ok << '\n';

    if (trainer_sections == 0) {
        std::cerr << "expected at least one trainer section" << std::endl;
        return 4;
    }

    return 0;
}

#include <iostream>
#include <string>

#include <puse/core/SaveSession.hpp>

int main(int argc, char **argv) {
    if (argc < 2) {
        std::cerr << "Usage: checksum_report <save_file>" << std::endl;
        return 1;
    }

    puse::core::SaveSession session;
    std::string error;
    if (!session.LoadFromFile(argv[1], &error)) {
        std::cerr << "load failed: " << error << std::endl;
        return 2;
    }

    const auto sections = session.Sections();
    for (const auto &sec : sections) {
        const auto calc = puse::core::ComputeSectionChecksumForSection(session.Buffer(), sec);
        std::cout << sec.index << ','
                  << sec.section_id << ','
                  << sec.valid_len << ','
                  << sec.stored_checksum << ','
                  << calc << ','
                  << sec.save_index << '\n';
    }

    return 0;
}

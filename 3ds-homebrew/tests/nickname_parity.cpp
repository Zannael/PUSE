#include <iomanip>
#include <iostream>
#include <string>

#include <puse/core/Party.hpp>
#include <puse/core/Pc.hpp>
#include <puse/core/SaveSections.hpp>
#include <puse/core/SaveSession.hpp>

namespace {

void PrintNicknameBytes(const uint8_t *bytes) {
    for (size_t i = 0; i < 10; ++i) {
        std::cout << std::hex << std::setfill('0') << std::setw(2)
                  << static_cast<unsigned>(bytes[i]);
    }
    std::cout << '\n';
}

} // namespace

int main(int argc, char **argv) {
    if (argc != 2) {
        std::cerr << "Usage: nickname_parity <save_file>\n";
        return 1;
    }

    puse::core::SaveSession session;
    std::string error;
    if (!session.LoadFromFile(argv[1], &error)) {
        std::cerr << error << '\n';
        return 2;
    }

    auto &buffer = session.MutableBuffer();
    if (!puse::core::UpdatePartyNickname(buffer, 0, "   ", &error)) {
        std::cerr << error << '\n';
        return 3;
    }

    bool found = false;
    size_t trainer_offset = 0;
    uint32_t save_index = 0;
    for (const auto &section : puse::core::ListSections(buffer)) {
        if (section.section_id == 1 && (!found || section.save_index > save_index)) {
            found = true;
            trainer_offset = section.offset;
            save_index = section.save_index;
        }
    }
    if (!found) {
        std::cerr << "trainer section not found\n";
        return 4;
    }
    PrintNicknameBytes(&buffer[trainer_offset + 0x38 + 0x08]);

    auto stream = puse::core::BuildPcStream(buffer, &error);
    if (!puse::core::UpdatePcMonNickname(stream, 1, 1, "", &error)) {
        std::cerr << error << '\n';
        return 5;
    }
    PrintNicknameBytes(&stream[0x08]);
}

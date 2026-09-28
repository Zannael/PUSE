#include <fstream>
#include <iostream>
#include <iterator>
#include <string>
#include <vector>

#include <puse/core/Party.hpp>
#include <puse/core/Pc.hpp>
#include <puse/core/SaveSession.hpp>

int main(int argc, char **argv) {
    if (argc != 5) {
        std::cerr << "Usage: happiness_native_parity input output party_value pc_value\n";
        return 1;
    }
    const int party_value = std::stoi(argv[3]);
    const int pc_value = std::stoi(argv[4]);
    puse::core::SaveSession session;
    std::string error;
    if (!session.LoadFromFile(argv[1], &error)) {
        std::cerr << error << '\n';
        return 2;
    }
    auto &buffer = session.MutableBuffer();
    auto stream = puse::core::BuildPcStream(buffer, &error);
    if (!puse::core::UpdatePartyHappiness(buffer, 0, party_value, &error)
        || !puse::core::UpdatePcMonHappiness(stream, 1, 1, pc_value, &error)
        || !puse::core::CommitPartySectionChecksums(buffer, &error)
        || !puse::core::CommitPcStream(buffer, stream, &error)) {
        std::cerr << error << '\n';
        return 3;
    }
    std::ofstream out(argv[2], std::ios::binary);
    out.write(reinterpret_cast<const char *>(buffer.data()), static_cast<std::streamsize>(buffer.size()));
    return out.good() ? 0 : 4;
}

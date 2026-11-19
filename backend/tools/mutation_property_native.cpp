// Shared host harness: compile against each port's actual core, never a mock.
#include <puse/core/SaveSession.hpp>
#include <puse/core/Party.hpp>
#include <puse/core/Pc.hpp>
#include <cassert>
#include <fstream>
#include <string>

int main(int argc, char **argv) {
    using namespace puse::core;
    assert(argc == 10);
    SaveSession session;
    std::string error;
    assert(session.LoadFromFile(argv[1], &error, argv[3]));
    auto save = session.Buffer();
    auto stream = BuildPcStream(save, &error);
    const auto original = save, original_stream = stream;
    const std::string operation = argv[4];
    const int index = std::stoi(argv[5]), box = std::stoi(argv[6]);
    const int slot = std::stoi(argv[7]), value = std::stoi(argv[8]);
    const bool rejected = std::string(argv[9]) == "reject";
    if (operation == "happiness") {
        const bool party_ok = UpdatePartyHappiness(save, index, value, &error);
        const bool pc_ok = UpdatePcMonHappiness(stream, box, slot, value, &error);
        assert(party_ok == !rejected && pc_ok == !rejected);
    } else {
        assert(operation == "item" && !rejected);
        assert(UpdatePartyItem(save, index, value, &error));
        assert(UpdatePcMonItem(stream, box, slot, value, &error));
    }
    if (rejected) assert(save == original && stream == original_stream);
    assert(CommitPcStream(save, stream, &error));
    if (rejected) assert(save == original);
    std::ofstream out(argv[2], std::ios::binary);
    out.write(reinterpret_cast<const char *>(save.data()), save.size());
    assert(out.good());
}

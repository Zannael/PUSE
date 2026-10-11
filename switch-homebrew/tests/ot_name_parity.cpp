#include <puse/core/Party.hpp>
#include <puse/core/Pc.hpp>
#include <puse/core/Bag.hpp>
#include <puse/core/SaveSession.hpp>
#include <cassert>
#include <iostream>

int main(int argc, char **argv) {
    if (argc != 3) return 1;
    puse::core::SaveSession session;
    std::string error;
    if (!session.LoadFromFile(argv[1], &error)) return 2;
    auto &save = session.MutableBuffer();
    auto stream = puse::core::BuildPcStream(save, &error);
    const auto before = save;
    const auto before_stream = stream;
    for (const std::string bad : {"", "   ", "12345678", "José", "Red\nBlue", "😀"}) {
        assert(!puse::core::UpdatePartyOtName(save, 0, bad, &error));
        assert(!puse::core::UpdatePcMonOtName(stream, 1, 1, bad, &error));
        assert(save == before && stream == before_stream);
    }
    assert(!puse::core::UpdatePartyOtName(save, -1, "Red", &error));
    assert(!puse::core::UpdatePartyOtName(save, 6, "Red", &error));
    assert(!puse::core::UpdatePcMonOtName(stream, 0, 1, "Red", &error));
    assert(!puse::core::UpdatePcMonOtName(stream, 1, 31, "Red", &error));
    if (!puse::core::UpdatePartyOtName(save, 0, argv[2], &error) ||
        !puse::core::UpdatePcMonOtName(stream, 1, 1, argv[2], &error) ||
        !puse::core::CommitPartySectionChecksums(save, &error) ||
        !puse::core::CommitBagSectorChecksums(save, &error) ||
        !puse::core::CommitPcStream(save, stream, &error)) {
        std::cerr << error;
        return 3;
    }
    const auto party = puse::core::ParseParty(save, {});
    const auto pc = puse::core::ParsePcBox(stream, 1, {});
    assert(!party.empty() && !pc.empty() && party[0].ot_name == pc[0].ot_name);
    std::cout.write(reinterpret_cast<const char *>(save.data()), save.size());
}

#include <puse/core/Party.hpp>
#include <puse/core/Bag.hpp>
#include <puse/core/Money.hpp>
#include <puse/core/SaveSections.hpp>
#include <puse/core/Pc.hpp>
#include <fstream>
#include <iterator>
#include <string>
int main(int argc, char** argv) {
    if (argc != 4) return 2;
    std::ifstream input(argv[1], std::ios::binary);
    std::vector<uint8_t> save((std::istreambuf_iterator<char>(input)), {});
    std::string error;
    auto stream = puse::core::BuildPcStream(save, &error);
    if (stream.empty()) return 3;
    auto protected_save = save;
    const auto selected = puse::core::ActiveUnboundSections(save);
    for (size_t off : {selected[4].offset, size_t(30 * 4096), size_t(31 * 4096)}) {
        puse::core::RecalculateSectionChecksum(protected_save, off);
    }
    if (protected_save != save) return 10;
    std::ofstream counts(std::string(argv[3]) + ".counts");
    for (int box = 1; box <= 24; ++box) {
        const int count = puse::core::CountPcBoxMons(stream, box);
        counts << count << "\n";
        if (count > 0) {
            bool released = false;
            for (int slot = 1; slot <= 30; ++slot) {
                auto candidate = stream;
                if (puse::core::ReleasePcMon(candidate, box, slot, &error)) {
                    if (puse::core::CountPcBoxMons(candidate, box) != count - 1) return 8;
                    released = true;
                    break;
                }
            }
            if (!released) return 9;
        }
    }
    std::ofstream gathered(std::string(argv[3]) + ".stream", std::ios::binary);
    gathered.write(reinterpret_cast<const char*>(stream.data()), stream.size());
    if (std::string(argv[2]) == "finalize") {
        uint32_t money = 0;
        if (!puse::core::ReadMoney(save, &money, &error)) return 5;
        std::ofstream(std::string(argv[3]) + ".money") << money;
        const auto active = puse::core::ActiveUnboundSections(save);
        if (!puse::core::WriteSlot(save, active[13].offset + 0x1A8, 1, 9, false)) return 7;
        if (!puse::core::WriteMoney(save, 123456, &error) ||
            !puse::core::CommitPartySectionChecksums(save, &error) ||
            !puse::core::CommitBagSectorChecksums(save, &error)) return 6;
    } else if (std::string(argv[2]) != "noop") {
        std::ifstream edits(argv[2], std::ios::binary);
        stream.assign(std::istreambuf_iterator<char>(edits), {});
    }
    if (!puse::core::CommitPcStream(save, stream, &error)) return 4;
    std::ofstream output(argv[3], std::ios::binary);
    output.write(reinterpret_cast<const char*>(save.data()), save.size());
}

#include <iostream>
#include <string>

#include <puse/core/PokedexFlags.hpp>
#include <puse/core/SaveSession.hpp>

namespace {

void PrintFlags(const char *label, const puse::core::PokedexFlags &flags) {
    std::cout << label << ','
              << (flags.trackable ? 1 : 0) << ','
              << (flags.seen ? 1 : 0) << ','
              << (flags.caught ? 1 : 0) << '\n';
}

} // namespace

int main(int argc, char **argv) {
    if (argc < 2) {
        std::cerr << "Usage: pokedex_flags_dump <save_file>" << std::endl;
        return 1;
    }

    puse::core::SaveSession session;
    std::string error;
    if (!session.LoadFromFile(argv[1], &error)) {
        std::cerr << "load failed: " << error << std::endl;
        return 2;
    }

    std::vector<uint8_t> buffer = session.Buffer();
    PrintFlags("initial_25", puse::core::GetPokedexFlags(buffer, 25));

    puse::core::PokedexFlags out{};
    if (!puse::core::SetPokedexFlag(buffer, 25, "seen", true, &out)) {
        std::cerr << "set seen failed" << std::endl;
        return 3;
    }
    PrintFlags("set_seen_25", out);

    if (!puse::core::SetPokedexFlag(buffer, 25, "caught", true, &out)) {
        std::cerr << "set caught failed" << std::endl;
        return 4;
    }
    PrintFlags("set_caught_25", out);

    if (!puse::core::SetPokedexFlag(buffer, 25, "caught", false, &out)) {
        std::cerr << "clear caught failed" << std::endl;
        return 5;
    }
    PrintFlags("clear_caught_25", out);
    PrintFlags("form_1020", puse::core::GetPokedexFlags(buffer, 1020));
    PrintFlags("untracked_1300", puse::core::GetPokedexFlags(buffer, 1300));
    return 0;
}

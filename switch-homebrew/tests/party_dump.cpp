#include <iostream>
#include <string>

#include <puse/core/Party.hpp>
#include <puse/core/SaveSession.hpp>
#include <puse/io/DataLoader.hpp>

int main(int argc, char **argv) {
    if (argc < 3) {
        std::cerr << "Usage: party_dump <save_file> <species_file>" << std::endl;
        return 1;
    }

    const std::string save_file = argv[1];
    const std::string species_file = argv[2];

    puse::core::SaveSession session;
    std::string error;
    if (!session.LoadFromFile(save_file, &error)) {
        std::cerr << "load failed: " << error << std::endl;
        return 2;
    }

    const auto species = puse::io::LoadIdNameFile(species_file);
    const auto party = puse::core::ParseParty(session.Buffer(), species);
    for (const auto &e : party) {
        std::cout << e.index << ','
                  << e.species_id << ','
                  << e.item_id << ','
                  << static_cast<int>(e.level) << ','
                  << e.exp << ','
                  << static_cast<int>(e.nature_id) << ','
                  << e.nickname << '\n';
    }
    return 0;
}

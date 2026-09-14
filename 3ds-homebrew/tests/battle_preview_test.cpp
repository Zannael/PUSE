#include <array>
#include <iostream>

#include <puse/core/Party.hpp>

int main() {
    std::string error;
    if (!puse::core::EnsurePartyStaticDataLoaded(&error)) {
        std::cerr << "static data load failed: " << error << '\n';
        return 1;
    }
    const std::array<uint8_t, 6> ivs = {{31, 31, 31, 31, 31, 31}};
    const std::array<uint8_t, 6> evs = {{0, 0, 0, 0, 0, 0}};
    const auto preview = puse::core::CalculateBattlePreview(25, 50, 0, ivs, evs);
    const std::array<uint16_t, 6> expected = {{110, 75, 60, 110, 70, 70}};
    if (!preview.available || preview.stats != expected || preview.hidden_power_type != "Dark") {
        std::cerr << "battle preview mismatch\n";
        return 2;
    }
    std::cout << "battle preview native regression passed\n";
    return 0;
}

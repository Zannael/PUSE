#include <puse/core/FieldInspector.hpp>
#include <puse/core/GameProfile.hpp>
#include <fstream>
#include <iostream>
#include <iterator>
#include <cassert>
int main(int argc, char** argv) {
    assert(argc == 3 && puse::core::profile::SelectProfile(argv[2]));
    std::ifstream in(argv[1], std::ios::binary);
    assert(in.good());
    const std::vector<uint8_t> input((std::istreambuf_iterator<char>(in)), {});
    const auto original = input;
    puse::core::FieldReport report;
    std::string error;
    if (!puse::core::BuildFieldReport(input, &report, &error)) {
        assert(input == original);
        std::cerr << error; return 3;
    }
    assert(input == original);
    std::cout << puse::core::FieldReportJson(report);
}

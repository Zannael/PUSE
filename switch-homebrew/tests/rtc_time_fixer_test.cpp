#include <puse/core/Rtc.hpp>

#include <fstream>
#include <iostream>
#include <iterator>
#include <string>
#include <vector>

int main(int argc, char **argv) {
    if (argc != 3) {
        std::cerr << "usage: rtc_time_fixer_test INPUT OUTPUT\n";
        return 2;
    }

    std::ifstream in(argv[1], std::ios::binary);
    std::vector<uint8_t> source((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    if (!in && source.empty()) {
        std::cerr << "cannot read input\n";
        return 2;
    }

    puse::core::RtcTimeFixerResult result;
    std::string error;
    if (!puse::core::ReenableTimeFixer(source, &result, &error)) {
        std::cerr << error << "\n";
        return 1;
    }

    std::ofstream out(argv[2], std::ios::binary);
    out.write(reinterpret_cast<const char *>(result.bytes.data()),
              static_cast<std::streamsize>(result.bytes.size()));
    if (!out) {
        std::cerr << "cannot write output\n";
        return 2;
    }

    std::cout << "save_idx=" << result.save_idx
              << " offset=" << result.absolute_offset
              << " before=" << static_cast<int>(result.before)
              << " after=" << static_cast<int>(result.after) << "\n";
    return 0;
}

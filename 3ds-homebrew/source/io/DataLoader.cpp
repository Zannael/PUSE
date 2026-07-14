#include <puse/io/DataLoader.hpp>

#include <cstdlib>
#include <cstdio>

namespace {

bool ProbeReadable(const std::string &path) {
    FILE *fp = std::fopen(path.c_str(), "rb");
    if (fp == nullptr) {
        return false;
    }
    std::fclose(fp);
    return true;
}

} // namespace

namespace puse::io {

std::string ResolveAssetPath(const std::string &relative_path) {
    static const char *kRoots[] = {
        "romfs:/",
#ifndef __3DS__
        "./romfs/",
#endif
#ifdef PUSE_ALLOW_SD_FALLBACK
        "sdmc:/3ds/puse/",
        "sdmc:/3ds/puse/romfs/",
#endif
    };

    for (const char *root : kRoots) {
        std::string path(root);
        path += relative_path;
        if (ProbeReadable(path)) {
            return path;
        }
    }

    return "";
}

std::unordered_map<int, std::string> LoadIdNameFile(const std::string &path) {
    std::unordered_map<int, std::string> out;
    FILE *fp = std::fopen(path.c_str(), "rb");
    if (fp == nullptr) {
        return out;
    }

    char line_buf[4096];
    while (std::fgets(line_buf, sizeof(line_buf), fp) != nullptr) {
        std::string raw(line_buf);
        if (raw.empty()) {
            continue;
        }

        const auto colon = raw.find(':');
        if (colon == std::string::npos) {
            continue;
        }

        std::string left = raw.substr(0, colon);
        std::string right = raw.substr(colon + 1);

        auto trim = [](std::string &s) {
            const auto first = s.find_first_not_of(" \t\r\n");
            if (first == std::string::npos) {
                s.clear();
                return;
            }
            const auto last = s.find_last_not_of(" \t\r\n");
            s = s.substr(first, last - first + 1);
        };

        trim(left);
        trim(right);
        if (left.empty()) {
            continue;
        }

        char *end = nullptr;
        const long parsed = std::strtol(left.c_str(), &end, 10);
        if ((end == nullptr) || (*end != '\0')) {
            continue;
        }
        out[static_cast<int>(parsed)] = right;
    }

    std::fclose(fp);
    return out;
}

} // namespace puse::io

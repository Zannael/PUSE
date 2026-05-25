#include "io/IconLoader.h"

#include <cstdio>
#include <dirent.h>
#include <string>
#include <cstring>

namespace puse::io {

static bool FileExists(const std::string& path) {
    FILE* f = fopen(path.c_str(), "r");
    if (!f) return false;
    fclose(f);
    return true;
}

// Prefix-search in dir for a file whose name starts with prefix (case-sensitive).
// Returns the full path on match, or "" on miss.
static std::string PrefixSearch(const std::string& dir, const std::string& prefix) {
    DIR* d = opendir(dir.c_str());
    if (!d) return "";
    struct dirent* ent;
    while ((ent = readdir(d)) != nullptr) {
        const char* n = ent->d_name;
        if (strncmp(n, prefix.c_str(), prefix.size()) == 0) {
            // Require next char to be non-digit (avoids 001 matching 0010)
            size_t plen = prefix.size();
            if (n[plen] == '\0' || n[plen] == '.' || n[plen] == '_' || n[plen] == '-') {
                closedir(d);
                return dir + "/" + n;
            }
        }
    }
    closedir(d);
    return "";
}

static const char* kMonRoots[] = {
    "romfs:/icons/pokemon",
    "sdmc:/3ds/puse/icons/pokemon",
};
static const int kMonRootCount = 2;

static const char* kItemRoots[] = {
    "romfs:/icons/items",
    "sdmc:/3ds/puse/icons/items",
};
static const int kItemRootCount = 2;

std::string ResolveMonIconPath(uint16_t species_id) {
    char buf4[8], buf3[8], prefix[24];
    snprintf(buf4,   sizeof(buf4),   "%04d",           (int)species_id);
    snprintf(buf3,   sizeof(buf3),   "%03d",           (int)species_id);
    snprintf(prefix, sizeof(prefix), "gFrontSprite%s", buf3);

    for (int i = 0; i < kMonRootCount; ++i) {
        std::string root = kMonRoots[i];

        std::string p = root + "/" + buf4 + ".png";
        if (FileExists(p)) return p;

        p = root + "/" + buf3 + ".png";
        if (FileExists(p)) return p;

        // Prefix match for Switch-style gFrontSprite names
        p = PrefixSearch(root, prefix);
        if (!p.empty()) return p;
    }
    return "";
}

std::string ResolveItemIconPath(uint16_t item_id) {
    char buf4[8], buf3[8];
    snprintf(buf4, sizeof(buf4), "%04d", (int)item_id);
    snprintf(buf3, sizeof(buf3), "%03d", (int)item_id);

    for (int i = 0; i < kItemRootCount; ++i) {
        std::string root = kItemRoots[i];

        std::string p = root + "/" + buf4 + ".png";
        if (FileExists(p)) return p;

        p = root + "/" + buf3 + ".png";
        if (FileExists(p)) return p;
    }
    return "";
}

} // namespace puse::io

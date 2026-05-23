#include <puse/core/Party.hpp>

#include <algorithm>
#include <array>
#include <cctype>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <fstream>
#include <functional>
#include <optional>
#include <regex>
#include <sstream>
#include <string>
#include <unordered_map>
#include <vector>

#include <puse/core/Binary.hpp>
#include <puse/core/SaveSections.hpp>
#include <puse/io/DataLoader.hpp>

namespace puse::core {

namespace {

constexpr size_t kTrainerSectionId = 1;
constexpr size_t kMonDataStart = 0x20;
constexpr size_t kMonSize = 100;
constexpr size_t kTeamCountOff = 0x34;
constexpr size_t kPartyBaseOff = 0x38;
constexpr size_t kMonNickOff = 0x08;
constexpr size_t kMonPidOff = 0x00;
constexpr size_t kMonOtidOff = 0x04;
constexpr size_t kMonOtNameOff = 0x14;
constexpr size_t kMonOtNameLen = 7;
constexpr size_t kMonChecksumOff = 0x1C;
constexpr size_t kMonLevelVisualOff = 0x54;
constexpr size_t kMonCurrHpOff = 0x56;
constexpr size_t kMonMaxHpOff = 0x58;
constexpr size_t kMonAtkOff = 0x5A;
constexpr size_t kMonDefOff = 0x5C;
constexpr size_t kMonSpeOff = 0x5E;
constexpr size_t kMonSpaOff = 0x60;
constexpr size_t kMonSpdOff = 0x62;

constexpr uint8_t kGenderThresholdMaleOnly = 0;
constexpr uint8_t kGenderThresholdFemaleOnly = 254;
constexpr uint8_t kGenderThresholdGenderless = 255;
constexpr int kShinyThreshold = 16;
constexpr int kInv11Mod25 = 16;

const std::array<const char *, 25> kNatureNames = {
    "Hardy", "Lonely", "Brave", "Adamant", "Naughty", "Bold", "Docile", "Relaxed", "Impish", "Lax",
    "Timid", "Hasty", "Serious", "Jolly", "Naive", "Modest", "Mild", "Quiet", "Bashful", "Rash",
    "Calm", "Gentle", "Sassy", "Careful", "Quirky",
};

const std::array<const char *, 6> kGrowthNames = {
    "Medium Fast (Cubic)", "Erratic", "Fluctuating", "Medium Slow", "Fast", "Slow",
};

struct BaseStats {
    int hp;
    int atk;
    int def;
    int spe;
    int spa;
    int spd;
};

struct SpeciesIdentityMeta {
    uint8_t gender_threshold;
};

struct SpeciesAbilitiesMeta {
    uint16_t ability_1_id;
    uint16_t ability_2_id;
    uint16_t hidden_ability_id;
};

std::unordered_map<int, BaseStats> g_species_base_stats;
std::unordered_map<int, SpeciesIdentityMeta> g_species_identity_meta;
std::unordered_map<int, int> g_species_growth_rates;
std::unordered_map<int, SpeciesAbilitiesMeta> g_species_abilities_meta;
std::unordered_map<int, int> g_move_base_pp;
std::unordered_map<int, std::string> g_abilities_db;
bool g_static_data_loaded = false;

const std::unordered_map<uint8_t, char> kDecodeCharmap = {
    {0x00, ' '}, {0xAB, '!'}, {0xAC, '?'}, {0xAD, '.'}, {0xAE, '-'},
    {0xB0, '0'}, {0xB1, '1'}, {0xB2, '2'}, {0xB3, '3'}, {0xB4, '4'},
    {0xB5, '5'}, {0xB6, '6'}, {0xB7, '7'}, {0xB8, '8'}, {0xB9, '9'},
};

std::unordered_map<char, uint8_t> BuildEncodeCharmap() {
    std::unordered_map<char, uint8_t> out = {
        {' ', 0x00}, {'!', 0xAB}, {'?', 0xAC}, {'.', 0xAD}, {'-', 0xAE}, {'\'', 0xB4},
    };
    for (int i = 0; i < 10; ++i) {
        out[static_cast<char>('0' + i)] = static_cast<uint8_t>(0xB0 + i);
    }
    for (int i = 0; i < 26; ++i) {
        out[static_cast<char>('A' + i)] = static_cast<uint8_t>(0xBB + i);
        out[static_cast<char>('a' + i)] = static_cast<uint8_t>(0xD5 + i);
    }
    return out;
}

const std::unordered_map<char, uint8_t> kEncodeCharmap = BuildEncodeCharmap();

const uint8_t *SubB(const uint8_t *raw_mon) {
    return raw_mon + kMonDataStart;
}

const uint8_t *SubA(const uint8_t *raw_mon) {
    return raw_mon + kMonDataStart + 12;
}

const uint8_t *SubD(const uint8_t *raw_mon) {
    return raw_mon + kMonDataStart + 24;
}

const uint8_t *SubC(const uint8_t *raw_mon) {
    return raw_mon + kMonDataStart + 36;
}

uint8_t *SubB(uint8_t *raw_mon) {
    return raw_mon + kMonDataStart;
}

uint8_t *SubA(uint8_t *raw_mon) {
    return raw_mon + kMonDataStart + 12;
}

uint8_t *SubD(uint8_t *raw_mon) {
    return raw_mon + kMonDataStart + 24;
}

uint8_t *SubC(uint8_t *raw_mon) {
    return raw_mon + kMonDataStart + 36;
}

int ParseInt(const std::string &value, bool *ok = nullptr) {
    char *end = nullptr;
    const long parsed = std::strtol(value.c_str(), &end, 10);
    const bool fine = (end != nullptr) && (*end == '\0');
    if (ok != nullptr) {
        *ok = fine;
    }
    return static_cast<int>(parsed);
}

bool ReadFileToString(const std::string &path, std::string *out) {
    std::ifstream in(path);
    if (!in.good()) {
        return false;
    }
    std::ostringstream ss;
    ss << in.rdbuf();
    *out = ss.str();
    return true;
}

bool ExtractIntField(const std::string &block, const std::string &name, int *out) {
    const std::regex field_re("\\\"" + name + "\\\"\\s*:\\s*(-?[0-9]+)");
    std::smatch m;
    if (!std::regex_search(block, m, field_re) || (m.size() < 2)) {
        return false;
    }
    bool ok = false;
    const int v = ParseInt(m[1].str(), &ok);
    if (!ok) {
        return false;
    }
    *out = v;
    return true;
}

template <typename Handler>
void ParseObjectEntries(const std::string &json_text, Handler handler) {
    const std::regex entry_re("\\\"([0-9]+)\\\"\\s*:\\s*\\{([^}]*)\\}");
    auto begin = std::sregex_iterator(json_text.begin(), json_text.end(), entry_re);
    auto end = std::sregex_iterator();
    for (auto it = begin; it != end; ++it) {
        const std::smatch m = *it;
        if (m.size() < 3) {
            continue;
        }
        bool ok = false;
        const int id = ParseInt(m[1].str(), &ok);
        if (!ok) {
            continue;
        }
        handler(id, m[2].str());
    }
}

void LoadSpeciesBaseStats(const std::string &path) {
    g_species_base_stats.clear();
    std::string text;
    if (!ReadFileToString(path, &text)) {
        return;
    }

    ParseObjectEntries(text, [](const int species_id, const std::string &block) {
        int hp = 0;
        int atk = 0;
        int def = 0;
        int spe = 0;
        int spa = 0;
        int spd = 0;
        if (!ExtractIntField(block, "hp", &hp) || !ExtractIntField(block, "atk", &atk) ||
            !ExtractIntField(block, "def", &def) || !ExtractIntField(block, "spe", &spe) ||
            !ExtractIntField(block, "spa", &spa) || !ExtractIntField(block, "spd", &spd)) {
            return;
        }
        g_species_base_stats[species_id] = {hp, atk, def, spe, spa, spd};
    });
}

void LoadSpeciesIdentityMeta(const std::string &path) {
    g_species_identity_meta.clear();
    std::string text;
    if (!ReadFileToString(path, &text)) {
        return;
    }

    ParseObjectEntries(text, [](const int species_id, const std::string &block) {
        int threshold = 0;
        if (!ExtractIntField(block, "gender_threshold", &threshold)) {
            return;
        }
        g_species_identity_meta[species_id] = {static_cast<uint8_t>(threshold & 0xFF)};
    });
}

void LoadSpeciesGrowthRates(const std::string &path) {
    g_species_growth_rates.clear();
    std::string text;
    if (!ReadFileToString(path, &text)) {
        return;
    }

    ParseObjectEntries(text, [](const int species_id, const std::string &block) {
        int growth_rate = -1;
        if (!ExtractIntField(block, "growth_rate", &growth_rate)) {
            return;
        }
        if ((growth_rate < 0) || (growth_rate > 5)) {
            return;
        }
        g_species_growth_rates[species_id] = growth_rate;
    });
}

void LoadSpeciesAbilitiesMeta(const std::string &path) {
    g_species_abilities_meta.clear();
    std::string text;
    if (!ReadFileToString(path, &text)) {
        return;
    }

    ParseObjectEntries(text, [](const int species_id, const std::string &block) {
        int a1 = 0;
        int a2 = 0;
        int ha = 0;
        if (!ExtractIntField(block, "ability_1_id", &a1) || !ExtractIntField(block, "ability_2_id", &a2) ||
            !ExtractIntField(block, "hidden_ability_id", &ha)) {
            return;
        }
        g_species_abilities_meta[species_id] = {
            static_cast<uint16_t>(a1 & 0xFFFF),
            static_cast<uint16_t>(a2 & 0xFFFF),
            static_cast<uint16_t>(ha & 0xFFFF),
        };
    });
}

void LoadMoveBasePp(const std::string &path) {
    g_move_base_pp.clear();
    std::string text;
    if (!ReadFileToString(path, &text)) {
        return;
    }

    const std::regex re("\\\"move_id\\\"\\s*:\\s*([0-9]+)[^}]*\\\"base_pp\\\"\\s*:\\s*([0-9]+)");
    auto begin = std::sregex_iterator(text.begin(), text.end(), re);
    auto end = std::sregex_iterator();
    for (auto it = begin; it != end; ++it) {
        const std::smatch m = *it;
        if (m.size() < 3) {
            continue;
        }
        bool ok_id = false;
        bool ok_pp = false;
        const int move_id = ParseInt(m[1].str(), &ok_id);
        const int base_pp = ParseInt(m[2].str(), &ok_pp);
        if (!ok_id || !ok_pp) {
            continue;
        }
        g_move_base_pp[move_id] = base_pp;
    }
}

std::string DecodeText(const uint8_t *buf, const size_t len) {
    std::string out;
    out.reserve(len);

    for (size_t i = 0; i < len; ++i) {
        const uint8_t b = buf[i];
        if (b == 0xFF) {
            break;
        }

        if ((b >= 0xBB) && (b <= 0xD4)) {
            out.push_back(static_cast<char>('A' + (b - 0xBB)));
        } else if ((b >= 0xD5) && (b <= 0xEE)) {
            out.push_back(static_cast<char>('a' + (b - 0xD5)));
        } else {
            auto it = kDecodeCharmap.find(b);
            out.push_back((it == kDecodeCharmap.end()) ? '?' : it->second);
        }
    }

    while (!out.empty() && out.back() == ' ') {
        out.pop_back();
    }
    return out;
}

void EncodeText(const std::string &text, uint8_t *out_buf, const size_t len) {
    std::fill(out_buf, out_buf + len, 0xFF);
    const std::string safe = text.substr(0, len);
    for (size_t i = 0; i < safe.size(); ++i) {
        auto it = kEncodeCharmap.find(safe[i]);
        out_buf[i] = (it == kEncodeCharmap.end()) ? 0xAC : it->second;
    }
}

bool IsMonEmpty(const uint8_t *raw_mon) {
    const uint32_t pid = ReadU32Le(raw_mon, kMonPidOff);
    const uint16_t species_id = ReadU16Le(SubB(raw_mon), 0);
    return (pid == 0U) && (species_id == 0U);
}

uint32_t ShinyValue(const uint32_t otid, const uint32_t pid) {
    const uint16_t tid = static_cast<uint16_t>(otid & 0xFFFFU);
    const uint16_t sid = static_cast<uint16_t>((otid >> 16U) & 0xFFFFU);
    return static_cast<uint32_t>(tid ^ sid ^ (pid & 0xFFFFU) ^ ((pid >> 16U) & 0xFFFFU));
}

bool IsShiny(const uint32_t otid, const uint32_t pid) {
    return ShinyValue(otid, pid) < static_cast<uint32_t>(kShinyThreshold);
}

std::optional<uint8_t> GetGenderThreshold(const uint16_t species_id) {
    auto it = g_species_identity_meta.find(static_cast<int>(species_id));
    if (it == g_species_identity_meta.end()) {
        return std::nullopt;
    }
    return it->second.gender_threshold;
}

std::string GenderModeFromThreshold(const std::optional<uint8_t> &threshold) {
    if (!threshold.has_value()) {
        return "unknown";
    }
    if (threshold.value() == kGenderThresholdGenderless) {
        return "genderless";
    }
    if (threshold.value() == kGenderThresholdMaleOnly) {
        return "fixed_male";
    }
    if (threshold.value() == kGenderThresholdFemaleOnly) {
        return "fixed_female";
    }
    return "dynamic";
}

std::string GenderFromPid(const uint32_t pid, const std::optional<uint8_t> &threshold) {
    if (!threshold.has_value()) {
        return "unknown";
    }
    if (threshold.value() == kGenderThresholdGenderless) {
        return "genderless";
    }
    if (threshold.value() == kGenderThresholdMaleOnly) {
        return "male";
    }
    if (threshold.value() == kGenderThresholdFemaleOnly) {
        return "female";
    }
    return ((pid & 0xFFU) < threshold.value()) ? "female" : "male";
}

int GetSpeciesGrowthRate(const uint16_t species_id) {
    auto it = g_species_growth_rates.find(static_cast<int>(species_id));
    if (it == g_species_growth_rates.end()) {
        return -1;
    }
    return it->second;
}

SpeciesAbilitiesMeta GetSpeciesAbilityIds(const uint16_t species_id) {
    auto it = g_species_abilities_meta.find(static_cast<int>(species_id));
    if (it == g_species_abilities_meta.end()) {
        return {0, 0, 0};
    }
    return it->second;
}

std::string GetAbilityNameById(const uint16_t ability_id) {
    if (ability_id == 0) {
        return "";
    }
    auto it = g_abilities_db.find(static_cast<int>(ability_id));
    if (it == g_abilities_db.end()) {
        return "";
    }
    return it->second;
}

int GetMoveBasePp(const uint16_t move_id) {
    auto it = g_move_base_pp.find(static_cast<int>(move_id));
    if (it == g_move_base_pp.end()) {
        return 0;
    }
    return it->second;
}

int CalculateMaxPp(const uint16_t move_id, const uint8_t pp_up_count) {
    if (move_id == 0) {
        return 0;
    }
    const int base_pp = GetMoveBasePp(move_id);
    const int pp_up = std::clamp(static_cast<int>(pp_up_count), 0, 3);
    if (base_pp <= 0) {
        return 0;
    }
    return base_pp + ((base_pp * pp_up) / 5);
}

float NatureModifier(const uint8_t nature_id, const std::string &stat_key) {
    const std::array<std::pair<const char *, const char *>, 25> inc_dec = {{
        {nullptr, nullptr},
        {"atk", "def"},
        {"atk", "spe"},
        {"atk", "spa"},
        {"atk", "spd"},
        {"def", "atk"},
        {nullptr, nullptr},
        {"def", "spe"},
        {"def", "spa"},
        {"def", "spd"},
        {"spe", "atk"},
        {"spe", "def"},
        {nullptr, nullptr},
        {"spe", "spa"},
        {"spe", "spd"},
        {"spa", "atk"},
        {"spa", "def"},
        {"spa", "spe"},
        {nullptr, nullptr},
        {"spa", "spd"},
        {"spd", "atk"},
        {"spd", "def"},
        {"spd", "spe"},
        {"spd", "spa"},
        {nullptr, nullptr},
    }};
    const auto pair = inc_dec[static_cast<size_t>(nature_id % 25U)];
    if ((pair.first != nullptr) && (stat_key == pair.first)) {
        return 1.1f;
    }
    if ((pair.second != nullptr) && (stat_key == pair.second)) {
        return 0.9f;
    }
    return 1.0f;
}

int CalcHpStat(const int base, const int iv, const int ev, const int level) {
    return ((2 * base + iv + (ev / 4)) * level) / 100 + level + 10;
}

int CalcOtherStat(const int base, const int iv, const int ev, const int level, const float nature_mul) {
    const int neutral = ((2 * base + iv + (ev / 4)) * level) / 100 + 5;
    return static_cast<int>(std::floor(static_cast<float>(neutral) * nature_mul));
}

uint16_t GetSpeciesId(const uint8_t *raw_mon) {
    return ReadU16Le(SubB(raw_mon), 0);
}

uint16_t GetItemId(const uint8_t *raw_mon) {
    return ReadU16Le(SubB(raw_mon), 2);
}

uint32_t GetExp(const uint8_t *raw_mon) {
    return ReadU32Le(SubB(raw_mon), 4);
}

std::array<uint16_t, 4> GetMoves(const uint8_t *raw_mon) {
    const uint8_t *a = SubA(raw_mon);
    return {
        ReadU16Le(a, 0),
        ReadU16Le(a, 2),
        ReadU16Le(a, 4),
        ReadU16Le(a, 6),
    };
}

std::array<uint8_t, 4> GetMovePp(const uint8_t *raw_mon) {
    const uint8_t *a = SubA(raw_mon);
    return {a[8], a[9], a[10], a[11]};
}

std::array<uint8_t, 4> GetMovePpUps(const uint8_t *raw_mon) {
    const uint8_t packed = SubB(raw_mon)[8];
    return {
        static_cast<uint8_t>((packed >> 0U) & 0x03U),
        static_cast<uint8_t>((packed >> 2U) & 0x03U),
        static_cast<uint8_t>((packed >> 4U) & 0x03U),
        static_cast<uint8_t>((packed >> 6U) & 0x03U),
    };
}

std::array<uint8_t, 6> GetIvs(const uint8_t *raw_mon) {
    const uint32_t packed = ReadU32Le(SubC(raw_mon), 4);
    return {
        static_cast<uint8_t>((packed >> 0U) & 0x1FU),
        static_cast<uint8_t>((packed >> 5U) & 0x1FU),
        static_cast<uint8_t>((packed >> 10U) & 0x1FU),
        static_cast<uint8_t>((packed >> 15U) & 0x1FU),
        static_cast<uint8_t>((packed >> 20U) & 0x1FU),
        static_cast<uint8_t>((packed >> 25U) & 0x1FU),
    };
}

std::array<uint8_t, 6> GetEvs(const uint8_t *raw_mon) {
    const uint8_t *d = SubD(raw_mon);
    return {d[0], d[1], d[2], d[3], d[4], d[5]};
}

uint8_t GetNatureId(const uint8_t *raw_mon) {
    const uint32_t pid = ReadU32Le(raw_mon, kMonPidOff);
    return static_cast<uint8_t>(pid % 25U);
}

bool GetHiddenAbilityFlag(const uint8_t *raw_mon) {
    const uint32_t packed = ReadU32Le(SubC(raw_mon), 4);
    return ((packed >> 31U) & 1U) != 0;
}

void SetHiddenAbilityFlag(uint8_t *raw_mon, const bool active) {
    uint8_t *c = SubC(raw_mon);
    uint32_t value = ReadU32Le(c, 4);
    if (active) {
        value |= (1U << 31U);
    } else {
        value &= ~(1U << 31U);
    }
    WriteU32Le(c, 4, value);
}

uint8_t GetStandardAbilitySlot(const uint8_t *raw_mon) {
    return static_cast<uint8_t>(ReadU32Le(raw_mon, kMonPidOff) & 1U);
}

void WriteMonChecksum(uint8_t *raw_mon) {
    // Unbound/CFRU battle init can treat non-zero party 0x1C as a species source
    // in one working-copy path. Keep party mon field 0x1C zeroed to prevent
    // runtime species substitution when entering battle.
    WriteU16Le(raw_mon, kMonChecksumOff, 0);
}

void SetItemId(uint8_t *raw_mon, const uint16_t item_id) {
    WriteU16Le(SubB(raw_mon), 2, item_id);
}

void SetSpeciesId(uint8_t *raw_mon, const uint16_t species_id) {
    WriteU16Le(SubB(raw_mon), 0, species_id);
}

void SetNickname(uint8_t *raw_mon, const std::string &nickname) {
    const std::string trimmed = nickname.substr(0, 10);
    EncodeText(trimmed, raw_mon + kMonNickOff, 10);
}

void SetExp(uint8_t *raw_mon, const uint32_t exp) {
    WriteU32Le(SubB(raw_mon), 4, exp);
}

void SetVisualLevel(uint8_t *raw_mon, const uint8_t level) {
    raw_mon[kMonLevelVisualOff] = level;
}

void SetNature(uint8_t *raw_mon, const uint8_t target_nature_id) {
    uint32_t pid = ReadU32Le(raw_mon, kMonPidOff);
    const uint32_t current_ability_slot = pid & 1U;
    while (((pid % 25U) != (target_nature_id % 25U)) || ((pid & 1U) != current_ability_slot)) {
        pid = (pid + 1U) & 0xFFFFFFFFU;
    }
    WriteU32Le(raw_mon, kMonPidOff, pid);
}

uint16_t NearestHighForMod(const uint16_t req_mod, const uint16_t preferred_high) {
    const int min_k = 0;
    const int max_k = (0xFFFF - req_mod) / 25;
    int k = static_cast<int>(std::round((static_cast<double>(preferred_high) - req_mod) / 25.0));
    k = std::max(min_k, std::min(max_k, k));
    return static_cast<uint16_t>(req_mod + (25 * k));
}

bool FindIdentityPid(
    const uint32_t current_pid,
    const uint32_t otid,
    const uint8_t target_nature_id,
    const bool desired_shiny,
    const std::optional<std::string> &desired_gender,
    const std::optional<uint8_t> &gender_threshold,
    const std::optional<uint8_t> &required_ability_slot,
    uint32_t *out_pid,
    std::string *error
) {
    std::optional<std::string> normalized_gender;
    if (desired_gender.has_value()) {
        std::string g = desired_gender.value();
        std::transform(g.begin(), g.end(), g.begin(), [](const unsigned char c) { return static_cast<char>(std::tolower(c)); });
        if (g != "male" && g != "female" && g != "genderless") {
            if (error != nullptr) {
                *error = "Invalid gender '" + desired_gender.value() + "'.";
            }
            return false;
        }
        normalized_gender = g;
    }

    if (normalized_gender.has_value()) {
        const std::string mode = GenderModeFromThreshold(gender_threshold);
        if (normalized_gender.value() == "genderless") {
            if (!gender_threshold.has_value() || (gender_threshold.value() != kGenderThresholdGenderless)) {
                if (error != nullptr) {
                    *error = "Selected species is not genderless.";
                }
                return false;
            }
        } else {
            if (mode == "unknown") {
                if (error != nullptr) {
                    *error = "Gender metadata unavailable for this species.";
                }
                return false;
            }
            if (mode == "genderless") {
                if (error != nullptr) {
                    *error = "Selected species is genderless.";
                }
                return false;
            }
            if ((mode == "fixed_male") && (normalized_gender.value() != "male")) {
                if (error != nullptr) {
                    *error = "Selected species is male-only.";
                }
                return false;
            }
            if ((mode == "fixed_female") && (normalized_gender.value() != "female")) {
                if (error != nullptr) {
                    *error = "Selected species is female-only.";
                }
                return false;
            }
        }
    }

    const uint16_t current_low = static_cast<uint16_t>(current_pid & 0xFFFFU);
    const uint16_t current_high = static_cast<uint16_t>((current_pid >> 16U) & 0xFFFFU);
    const uint16_t tid_sid = static_cast<uint16_t>((otid & 0xFFFFU) ^ ((otid >> 16U) & 0xFFFFU));

    for (int delta = 0; delta < 0x10000; ++delta) {
        const uint16_t low = static_cast<uint16_t>((current_low + static_cast<uint16_t>(delta)) & 0xFFFFU);

        if (required_ability_slot.has_value() && ((low & 1U) != required_ability_slot.value())) {
            continue;
        }

        if (normalized_gender.has_value() && (normalized_gender.value() == "male" || normalized_gender.value() == "female") &&
            (GenderModeFromThreshold(gender_threshold) == "dynamic")) {
            if (GenderFromPid(low, gender_threshold) != normalized_gender.value()) {
                continue;
            }
        }

        const uint16_t req_high_mod = static_cast<uint16_t>((((target_nature_id % 25U) - (low % 25U)) * kInv11Mod25) % 25U);

        if (desired_shiny) {
            for (int sv = 0; sv < kShinyThreshold; ++sv) {
                const uint16_t high = static_cast<uint16_t>((tid_sid ^ low ^ static_cast<uint16_t>(sv)) & 0xFFFFU);
                if ((high % 25U) != req_high_mod) {
                    continue;
                }

                const uint32_t pid = (static_cast<uint32_t>(high) << 16U) | low;
                if (normalized_gender.has_value() && (GenderFromPid(pid, gender_threshold) != normalized_gender.value())) {
                    continue;
                }
                *out_pid = pid;
                return true;
            }
            continue;
        }

        const uint16_t base_high = NearestHighForMod(req_high_mod, current_high);
        const uint32_t base_pid = (static_cast<uint32_t>(base_high) << 16U) | low;

        if (!IsShiny(otid, base_pid)) {
            if (!normalized_gender.has_value() || (GenderFromPid(base_pid, gender_threshold) == normalized_gender.value())) {
                *out_pid = base_pid;
                return true;
            }
        }

        uint32_t found_non_shiny = 0;
        bool found = false;
        for (int n = 1; n <= 5 && !found; ++n) {
            for (int sign = -1; sign <= 1; sign += 2) {
                const int test_high = static_cast<int>(base_high) + (sign * 25 * n);
                if ((test_high < 0) || (test_high > 0xFFFF)) {
                    continue;
                }

                const uint32_t test_pid = (static_cast<uint32_t>(test_high) << 16U) | low;
                if (!IsShiny(otid, test_pid)) {
                    found_non_shiny = test_pid;
                    found = true;
                    break;
                }
            }
        }

        if (!found) {
            continue;
        }

        if (normalized_gender.has_value() && (GenderFromPid(found_non_shiny, gender_threshold) != normalized_gender.value())) {
            continue;
        }

        *out_pid = found_non_shiny;
        return true;
    }

    if (error != nullptr) {
        *error = "Could not find a PID satisfying all identity constraints.";
    }
    return false;
}

bool SetIdentity(uint8_t *raw_mon, const std::optional<bool> &shiny, const std::optional<std::string> &gender, std::string *error) {
    const uint32_t current_pid = ReadU32Le(raw_mon, kMonPidOff);
    const uint32_t otid = ReadU32Le(raw_mon, kMonOtidOff);

    const bool desired_shiny = shiny.has_value() ? shiny.value() : IsShiny(otid, current_pid);

    std::optional<std::string> desired_gender = gender;
    if (!desired_gender.has_value()) {
        const std::string mode = GenderModeFromThreshold(GetGenderThreshold(GetSpeciesId(raw_mon)));
        if (mode == "dynamic") {
            desired_gender = GenderFromPid(current_pid, GetGenderThreshold(GetSpeciesId(raw_mon)));
        }
    }

    std::optional<uint8_t> required_ability_slot;
    if (!GetHiddenAbilityFlag(raw_mon)) {
        required_ability_slot = GetStandardAbilitySlot(raw_mon);
    }

    uint32_t next_pid = 0;
    if (!FindIdentityPid(
            current_pid,
            otid,
            GetNatureId(raw_mon),
            desired_shiny,
            desired_gender,
            GetGenderThreshold(GetSpeciesId(raw_mon)),
            required_ability_slot,
            &next_pid,
            error)) {
        return false;
    }

    WriteU32Le(raw_mon, kMonPidOff, next_pid);
    return true;
}

void SetIvs(uint8_t *raw_mon, const std::array<uint8_t, 6> &ivs) {
    uint8_t *c = SubC(raw_mon);
    const uint32_t orig = ReadU32Le(c, 4);
    uint32_t next = orig & 0xC0000000U;
    next |= (static_cast<uint32_t>(ivs[0] & 0x1F) << 0U);
    next |= (static_cast<uint32_t>(ivs[1] & 0x1F) << 5U);
    next |= (static_cast<uint32_t>(ivs[2] & 0x1F) << 10U);
    next |= (static_cast<uint32_t>(ivs[3] & 0x1F) << 15U);
    next |= (static_cast<uint32_t>(ivs[4] & 0x1F) << 20U);
    next |= (static_cast<uint32_t>(ivs[5] & 0x1F) << 25U);
    WriteU32Le(c, 4, next);
}

void SetEvs(uint8_t *raw_mon, const std::array<uint8_t, 6> &evs) {
    uint8_t *d = SubD(raw_mon);
    for (size_t i = 0; i < 6; ++i) {
        d[i] = evs[i];
    }
}

void SetMoves(
    uint8_t *raw_mon,
    const std::array<uint16_t, 4> &moves,
    const std::optional<std::array<uint8_t, 4>> &move_pp,
    const std::optional<std::array<uint8_t, 4>> &move_pp_ups
) {
    uint8_t *a = SubA(raw_mon);
    uint8_t *b = SubB(raw_mon);

    const auto curr_moves = GetMoves(raw_mon);
    auto next_pp = GetMovePp(raw_mon);
    auto next_pp_ups = GetMovePpUps(raw_mon);

    if (move_pp_ups.has_value()) {
        for (size_t i = 0; i < 4; ++i) {
            next_pp_ups[i] = static_cast<uint8_t>(std::clamp(static_cast<int>(move_pp_ups.value()[i]), 0, 3));
        }
    }

    if (move_pp.has_value()) {
        for (size_t i = 0; i < 4; ++i) {
            next_pp[i] = move_pp.value()[i];
        }
    }

    for (size_t i = 0; i < 4; ++i) {
        const uint16_t move_id = static_cast<uint16_t>(moves[i] & 0x03FFU);
        const bool changed_move = (move_id != curr_moves[i]);

        if (move_id == 0) {
            next_pp_ups[i] = 0;
            next_pp[i] = 0;
        } else {
            const int max_pp = CalculateMaxPp(move_id, next_pp_ups[i]);
            if (changed_move) {
                next_pp[i] = static_cast<uint8_t>(std::clamp(max_pp, 0, 255));
            } else {
                next_pp[i] = static_cast<uint8_t>(std::clamp(static_cast<int>(next_pp[i]), 0, max_pp));
            }
        }

        WriteU16Le(a, i * 2, move_id);
        a[8 + i] = next_pp[i];
    }

    const uint8_t packed_pp_up = static_cast<uint8_t>(
        ((next_pp_ups[0] & 0x03U) << 0U) |
        ((next_pp_ups[1] & 0x03U) << 2U) |
        ((next_pp_ups[2] & 0x03U) << 4U) |
        ((next_pp_ups[3] & 0x03U) << 6U));
    b[8] = packed_pp_up;
}

void RecalculatePartyStats(uint8_t *raw_mon, const bool clamp_hp) {
    const uint16_t species_id = GetSpeciesId(raw_mon);
    auto it = g_species_base_stats.find(static_cast<int>(species_id));
    if (it == g_species_base_stats.end()) {
        return;
    }
    const BaseStats &base = it->second;

    const int level = std::max(1, static_cast<int>(raw_mon[kMonLevelVisualOff]));
    const auto ivs = GetIvs(raw_mon);
    const auto evs = GetEvs(raw_mon);
    const uint8_t nature_id = GetNatureId(raw_mon);

    const int max_hp = CalcHpStat(base.hp, ivs[0], evs[0], level);
    const int atk = CalcOtherStat(base.atk, ivs[1], evs[1], level, NatureModifier(nature_id, "atk"));
    const int def = CalcOtherStat(base.def, ivs[2], evs[2], level, NatureModifier(nature_id, "def"));
    const int spe = CalcOtherStat(base.spe, ivs[3], evs[3], level, NatureModifier(nature_id, "spe"));
    const int spa = CalcOtherStat(base.spa, ivs[4], evs[4], level, NatureModifier(nature_id, "spa"));
    const int spd = CalcOtherStat(base.spd, ivs[5], evs[5], level, NatureModifier(nature_id, "spd"));

    const int old_hp = static_cast<int>(ReadU16Le(raw_mon, kMonCurrHpOff));
    const int hp = clamp_hp ? std::min(old_hp, max_hp) : max_hp;

    WriteU16Le(raw_mon, kMonCurrHpOff, static_cast<uint16_t>(std::max(0, hp)));
    WriteU16Le(raw_mon, kMonMaxHpOff, static_cast<uint16_t>(std::max(1, max_hp)));
    WriteU16Le(raw_mon, kMonAtkOff, static_cast<uint16_t>(std::max(1, atk)));
    WriteU16Le(raw_mon, kMonDefOff, static_cast<uint16_t>(std::max(1, def)));
    WriteU16Le(raw_mon, kMonSpeOff, static_cast<uint16_t>(std::max(1, spe)));
    WriteU16Le(raw_mon, kMonSpaOff, static_cast<uint16_t>(std::max(1, spa)));
    WriteU16Le(raw_mon, kMonSpdOff, static_cast<uint16_t>(std::max(1, spd)));
}

uint32_t ExpAtLevel(const int rate_idx, int n) {
    if (n <= 1) return 0;
    if (n > 100) n = 100;

    switch (rate_idx) {
        case 0:
            return static_cast<uint32_t>(n * n * n);
        case 1:
            if (n <= 50) return static_cast<uint32_t>((n * n * n * (100 - n)) / 50);
            if (n <= 68) return static_cast<uint32_t>((n * n * n * (150 - n)) / 100);
            if (n <= 98) return static_cast<uint32_t>((n * n * n * ((1911 - 10 * n) / 3)) / 500);
            return static_cast<uint32_t>((n * n * n * (160 - n)) / 100);
        case 2:
            if (n <= 15) return static_cast<uint32_t>(n * n * n * ((std::floor((n + 1) / 3.0) + 24) / 50.0));
            if (n <= 36) return static_cast<uint32_t>(n * n * n * ((n + 14) / 50.0));
            return static_cast<uint32_t>(n * n * n * ((std::floor(n / 2.0) + 32) / 50.0));
        case 3:
            return static_cast<uint32_t>(1.2 * (n * n * n) - 15 * (n * n) + 100 * n - 140);
        case 4:
            return static_cast<uint32_t>((4 * (n * n * n)) / 5);
        case 5:
            return static_cast<uint32_t>((5 * (n * n * n)) / 4);
        default:
            return static_cast<uint32_t>(n * n * n);
    }
}

int CalcCurrentLevel(const int rate_idx, const uint32_t current_exp) {
    for (int level = 1; level <= 100; ++level) {
        if (current_exp < ExpAtLevel(rate_idx, level + 1)) {
            return level;
        }
    }
    return 100;
}

std::pair<int, std::string> GuessGrowthRate(const uint32_t current_exp, const uint8_t visual_level) {
    const int visual = std::max(1, std::min(100, static_cast<int>(visual_level)));

    struct Candidate {
        int rate;
        bool in_band;
        int level_delta;
        int exp_distance;
    };

    std::vector<Candidate> ranked;
    ranked.reserve(6);

    for (int rate = 0; rate < 6; ++rate) {
        const int inferred = CalcCurrentLevel(rate, current_exp);
        const uint32_t exp_at_visual = ExpAtLevel(rate, visual);
        const uint32_t exp_at_next = ExpAtLevel(rate, std::min(100, visual + 1));
        const bool in_band = (exp_at_visual <= current_exp) && (current_exp < exp_at_next);

        int exp_distance = 0;
        if (!in_band) {
            if (current_exp < exp_at_visual) {
                exp_distance = static_cast<int>(exp_at_visual - current_exp);
            } else {
                exp_distance = std::max(0, static_cast<int>(current_exp - exp_at_next + 1));
            }
        }

        ranked.push_back({rate, in_band, std::abs(inferred - visual), exp_distance});
    }

    std::sort(ranked.begin(), ranked.end(), [](const Candidate &a, const Candidate &b) {
        if (a.in_band != b.in_band) return a.in_band > b.in_band;
        if (a.level_delta != b.level_delta) return a.level_delta < b.level_delta;
        if (a.exp_distance != b.exp_distance) return a.exp_distance < b.exp_distance;
        return a.rate < b.rate;
    });

    const Candidate best = ranked[0];
    std::string confidence = "low";
    if (best.in_band && (best.level_delta == 0)) {
        if (ranked.size() == 1) {
            confidence = "high";
        } else {
            const Candidate runner = ranked[1];
            if (!runner.in_band || (runner.level_delta > 0)) {
                confidence = "high";
            } else {
                confidence = "medium";
            }
        }
    } else if (best.level_delta <= 1) {
        confidence = "medium";
    }

    return {best.rate, confidence};
}

bool ResolveCurrentAbility(
    const int current_index,
    const SpeciesAbilitiesMeta &ability_meta,
    uint16_t *effective_id,
    std::string *effective_name,
    std::string *label
) {
    const std::string a1_name = GetAbilityNameById(ability_meta.ability_1_id);
    const std::string a2_name = GetAbilityNameById(ability_meta.ability_2_id);
    const std::string ha_name = GetAbilityNameById(ability_meta.hidden_ability_id);

    if (current_index == 0) {
        *effective_id = (ability_meta.ability_1_id != 0) ? ability_meta.ability_1_id : ability_meta.ability_2_id;
        *effective_name = !a1_name.empty() ? a1_name : a2_name;
        *label = effective_name->empty() ? "Slot 1 (Standard)" : *effective_name;
        return true;
    }

    if (current_index == 1) {
        *effective_id = (ability_meta.ability_2_id != 0) ? ability_meta.ability_2_id : ability_meta.ability_1_id;
        *effective_name = !a2_name.empty() ? a2_name : a1_name;
        *label = effective_name->empty() ? "Slot 2 (Standard)" : *effective_name;
        return true;
    }

    *effective_id = (ability_meta.hidden_ability_id != 0) ? ability_meta.hidden_ability_id : 0;
    *effective_name = ha_name;
    *label = effective_name->empty() ? "Hidden Ability" : *effective_name;
    return true;
}

bool FindActiveTrainerSection(const std::vector<uint8_t> &buffer, SaveSection *section, std::string *error) {
    const auto sections = ListSections(buffer);
    bool found = false;
    SaveSection active{};

    for (const auto &sec : sections) {
        if (sec.section_id != kTrainerSectionId) {
            continue;
        }
        if (!found || (sec.save_index > active.save_index)) {
            active = sec;
            found = true;
        }
    }

    if (!found) {
        if (error != nullptr) {
            *error = "trainer section not found";
        }
        return false;
    }

    if ((active.offset + kSectionSize) > buffer.size()) {
        if (error != nullptr) {
            *error = "trainer section is out of bounds";
        }
        return false;
    }

    *section = active;
    return true;
}

bool MutatePartyMon(
    std::vector<uint8_t> &buffer,
    const int index,
    const bool allow_species_change,
    const std::function<bool(uint8_t *, std::string *)> &mutator,
    std::string *error
) {
    SaveSection sec{};
    if (!FindActiveTrainerSection(buffer, &sec, error)) {
        return false;
    }

    if ((index < 0) || (index > 5)) {
        if (error != nullptr) {
            *error = "invalid party index";
        }
        return false;
    }

    uint8_t *trainer = &buffer[sec.offset];
    const uint32_t team_count = std::min(ReadU32Le(trainer, kTeamCountOff), 6U);
    if (static_cast<uint32_t>(index) >= team_count) {
        if (error != nullptr) {
            *error = "party index outside team count";
        }
        return false;
    }

    const size_t mon_off = kPartyBaseOff + (static_cast<size_t>(index) * kMonSize);
    if ((mon_off + kMonSize) > kSectionSize) {
        if (error != nullptr) {
            *error = "party mon offset out of bounds";
        }
        return false;
    }

    uint8_t *mon = trainer + mon_off;
    const uint16_t species_before = GetSpeciesId(mon);

    if (!mutator(mon, error)) {
        return false;
    }

    if (!allow_species_change) {
        const uint16_t species_after = GetSpeciesId(mon);
        if (species_before != species_after) {
            if (error != nullptr) {
                *error = "safety check failed: species changed unexpectedly";
            }
            return false;
        }
    }

    WriteMonChecksum(mon);
    return true;
}

} // namespace

bool EnsurePartyStaticDataLoaded(std::string *error) {
    if (g_static_data_loaded) {
        return true;
    }

    const std::string abilities_path = io::ResolveAssetPath("data/abilities.txt");
    const std::string base_stats_path = io::ResolveAssetPath("data/species_base_stats.json");
    const std::string identity_path = io::ResolveAssetPath("data/species_identity_meta.json");
    const std::string growth_path = io::ResolveAssetPath("data/species_growth_rates.json");
    const std::string species_abilities_path = io::ResolveAssetPath("data/species_abilities_meta.json");
    const std::string move_table_path = io::ResolveAssetPath("data/move_table_from_rom.json");

    if (abilities_path.empty() || base_stats_path.empty() || identity_path.empty() || growth_path.empty() || species_abilities_path.empty()) {
        if (error != nullptr) {
            *error = "missing required static party data files";
        }
        return false;
    }

    g_abilities_db = io::LoadIdNameFile(abilities_path);
    LoadSpeciesBaseStats(base_stats_path);
    LoadSpeciesIdentityMeta(identity_path);
    LoadSpeciesGrowthRates(growth_path);
    LoadSpeciesAbilitiesMeta(species_abilities_path);
    if (!move_table_path.empty()) {
        LoadMoveBasePp(move_table_path);
    }

    g_static_data_loaded = true;
    return true;
}

std::vector<PartyEntry> ParseParty(
    const std::vector<uint8_t> &buffer,
    const std::unordered_map<int, std::string> &species_db
) {
    EnsurePartyStaticDataLoaded(nullptr);

    std::vector<PartyEntry> out;
    SaveSection active{};
    if (!FindActiveTrainerSection(buffer, &active, nullptr)) {
        return out;
    }

    const uint8_t *sec = &buffer[active.offset];
    uint32_t team_count = ReadU32Le(sec, kTeamCountOff);
    if (team_count > 6) {
        team_count = 6;
    }

    out.reserve(team_count);
    for (uint32_t i = 0; i < team_count; ++i) {
        const size_t mon_off = kPartyBaseOff + (static_cast<size_t>(i) * kMonSize);
        if ((mon_off + kMonSize) > kSectionSize) {
            break;
        }

        const uint8_t *raw_mon = sec + mon_off;
        if (IsMonEmpty(raw_mon)) {
            continue;
        }

        PartyEntry e{};
        e.index = static_cast<int>(i);
        e.pid = ReadU32Le(raw_mon, kMonPidOff);
        e.otid = ReadU32Le(raw_mon, kMonOtidOff);
        e.ot_name = DecodeText(raw_mon + kMonOtNameOff, kMonOtNameLen);
        e.nickname = DecodeText(raw_mon + kMonNickOff, 10);
        e.species_id = GetSpeciesId(raw_mon);
        e.item_id = GetItemId(raw_mon);
        e.exp = GetExp(raw_mon);
        e.level = raw_mon[kMonLevelVisualOff];
        e.nature_id = GetNatureId(raw_mon);
        e.nature_name = kNatureNames[e.nature_id];
        e.is_shiny = IsShiny(e.otid, e.pid);

        const auto threshold = GetGenderThreshold(e.species_id);
        e.gender = GenderFromPid(e.pid, threshold);
        e.gender_mode = GenderModeFromThreshold(threshold);
        e.gender_editable = (e.gender_mode == "dynamic");

        e.hidden_ability = GetHiddenAbilityFlag(raw_mon);
        e.ability_slot = GetStandardAbilitySlot(raw_mon);
        e.current_ability_index = e.hidden_ability ? 2 : static_cast<int>(e.ability_slot);
        e.species_growth_rate = GetSpeciesGrowthRate(e.species_id);

        const SpeciesAbilitiesMeta ability_meta = GetSpeciesAbilityIds(e.species_id);
        e.ability_1_id = ability_meta.ability_1_id;
        e.ability_2_id = ability_meta.ability_2_id;
        e.ability_hidden_id = ability_meta.hidden_ability_id;
        e.ability_1_name = GetAbilityNameById(e.ability_1_id);
        e.ability_2_name = GetAbilityNameById(e.ability_2_id);
        e.ability_hidden_name = GetAbilityNameById(e.ability_hidden_id);
        ResolveCurrentAbility(
            e.current_ability_index,
            ability_meta,
            &e.effective_ability_id,
            &e.effective_ability_name,
            &e.ability_label_current);

        e.ivs = GetIvs(raw_mon);
        e.evs = GetEvs(raw_mon);
        e.move_ids = GetMoves(raw_mon);
        e.move_pp = GetMovePp(raw_mon);
        e.move_pp_ups = GetMovePpUps(raw_mon);
        for (size_t slot = 0; slot < 4; ++slot) {
            e.move_pp_max[slot] = static_cast<uint8_t>(std::clamp(CalculateMaxPp(e.move_ids[slot], e.move_pp_ups[slot]), 0, 255));
        }

        const auto it = species_db.find(static_cast<int>(e.species_id));
        e.species_name = (it == species_db.end()) ? "Unknown" : it->second;
        out.push_back(e);
    }

    return out;
}

bool UpdatePartyNickname(std::vector<uint8_t> &buffer, const int index, const std::string &nickname, std::string *error) {
    return MutatePartyMon(buffer, index, false, [&](uint8_t *mon, std::string *) {
        SetNickname(mon, nickname);
        return true;
    }, error);
}

bool UpdatePartyItem(std::vector<uint8_t> &buffer, const int index, const uint16_t item_id, std::string *error) {
    return MutatePartyMon(buffer, index, false, [&](uint8_t *mon, std::string *) {
        SetItemId(mon, item_id);
        return true;
    }, error);
}

bool UpdatePartySpecies(std::vector<uint8_t> &buffer, const int index, const uint16_t species_id, std::string *error) {
    return MutatePartyMon(buffer, index, true, [&](uint8_t *mon, std::string *) {
        SetSpeciesId(mon, species_id);
        RecalculatePartyStats(mon, true);
        return true;
    }, error);
}

bool UpdatePartyNature(std::vector<uint8_t> &buffer, const int index, const uint8_t nature_id, std::string *error) {
    return MutatePartyMon(buffer, index, false, [&](uint8_t *mon, std::string *) {
        SetNature(mon, static_cast<uint8_t>(nature_id % 25U));
        RecalculatePartyStats(mon, true);
        return true;
    }, error);
}

bool UpdatePartyIdentity(
    std::vector<uint8_t> &buffer,
    const int index,
    const std::optional<bool> &shiny,
    const std::optional<std::string> &gender,
    std::string *error
) {
    return MutatePartyMon(buffer, index, false, [&](uint8_t *mon, std::string *op_error) {
        if (!SetIdentity(mon, shiny, gender, op_error)) {
            return false;
        }
        RecalculatePartyStats(mon, true);
        return true;
    }, error);
}

bool UpdatePartyAbilitySwitch(std::vector<uint8_t> &buffer, const int index, const int ability_index, std::string *error) {
    if ((ability_index < 0) || (ability_index > 2)) {
        if (error != nullptr) {
            *error = "ability_index must be 0, 1, or 2";
        }
        return false;
    }

    return MutatePartyMon(buffer, index, false, [&](uint8_t *mon, std::string *) {
        if (ability_index == 2) {
            SetHiddenAbilityFlag(mon, true);
            return true;
        }

        SetHiddenAbilityFlag(mon, false);
        uint32_t pid = ReadU32Le(mon, kMonPidOff);
        const uint32_t target_nature = pid % 25U;
        while (((pid % 25U) != target_nature) || ((pid & 1U) != static_cast<uint32_t>(ability_index))) {
            pid = (pid + 1U) & 0xFFFFFFFFU;
        }
        WriteU32Le(mon, kMonPidOff, pid);
        return true;
    }, error);
}

bool UpdatePartyAbilityFlag(std::vector<uint8_t> &buffer, const int index, const bool is_hidden, std::string *error) {
    return MutatePartyMon(buffer, index, false, [&](uint8_t *mon, std::string *) {
        SetHiddenAbilityFlag(mon, is_hidden);
        return true;
    }, error);
}

bool UpdatePartyIvs(std::vector<uint8_t> &buffer, const int index, const std::array<uint8_t, 6> &ivs, std::string *error) {
    return MutatePartyMon(buffer, index, false, [&](uint8_t *mon, std::string *) {
        std::array<uint8_t, 6> clamped = ivs;
        for (auto &v : clamped) {
            v = static_cast<uint8_t>(std::clamp(static_cast<int>(v), 0, 31));
        }
        SetIvs(mon, clamped);
        RecalculatePartyStats(mon, true);
        return true;
    }, error);
}

bool UpdatePartyEvs(std::vector<uint8_t> &buffer, const int index, const std::array<uint8_t, 6> &evs, std::string *error) {
    return MutatePartyMon(buffer, index, false, [&](uint8_t *mon, std::string *) {
        SetEvs(mon, evs);
        RecalculatePartyStats(mon, true);
        return true;
    }, error);
}

bool UpdatePartyMoves(
    std::vector<uint8_t> &buffer,
    const int index,
    const std::array<uint16_t, 4> &moves,
    const std::optional<std::array<uint8_t, 4>> &move_pp,
    const std::optional<std::array<uint8_t, 4>> &move_pp_ups,
    std::string *error
) {
    for (const auto move_id : moves) {
        if (move_id > 1023U) {
            if (error != nullptr) {
                *error = "invalid move_id in moves payload";
            }
            return false;
        }
    }

    return MutatePartyMon(buffer, index, false, [&](uint8_t *mon, std::string *) {
        SetMoves(mon, moves, move_pp, move_pp_ups);
        return true;
    }, error);
}

bool UpdatePartyLevel(
    std::vector<uint8_t> &buffer,
    const int index,
    const int requested_level,
    const std::optional<int> &growth_rate,
    PartyLevelResult *result,
    std::string *error
) {
    return MutatePartyMon(buffer, index, false, [&](uint8_t *mon, std::string *op_error) {
        const int target_level = std::clamp(requested_level, 1, 100);
        int resolved_growth_rate = -1;
        std::string confidence;

        if (growth_rate.has_value()) {
            if ((growth_rate.value() < 0) || (growth_rate.value() > 5)) {
                if (op_error != nullptr) {
                    *op_error = "growth_rate must be between 0 and 5";
                }
                return false;
            }
            resolved_growth_rate = growth_rate.value();
            confidence = "manual";
        } else {
            const int species_growth = GetSpeciesGrowthRate(GetSpeciesId(mon));
            if (species_growth >= 0) {
                resolved_growth_rate = species_growth;
                confidence = "species";
            } else {
                const auto guessed = GuessGrowthRate(GetExp(mon), mon[kMonLevelVisualOff]);
                resolved_growth_rate = guessed.first;
                confidence = guessed.second;
            }
        }

        const uint32_t new_exp = ExpAtLevel(resolved_growth_rate, target_level);
        SetExp(mon, new_exp);
        SetVisualLevel(mon, static_cast<uint8_t>(target_level));
        RecalculatePartyStats(mon, true);

        if (result != nullptr) {
            result->requested_level = requested_level;
            result->target_level = target_level;
            result->was_clamped = (requested_level != target_level);
            result->exp = new_exp;
            result->growth_rate = resolved_growth_rate;
            result->growth_name = kGrowthNames[static_cast<size_t>(resolved_growth_rate)];
            result->confidence = confidence;
        }
        return true;
    }, error);
}

bool CommitPartySectionChecksums(std::vector<uint8_t> &buffer, std::string *error) {
    const auto sections = ListSections(buffer);
    if (sections.empty()) {
        if (error != nullptr) {
            *error = "save has no sections";
        }
        return false;
    }

    bool found = false;
    for (const auto &sec : sections) {
        if (sec.section_id != kTrainerSectionId) {
            continue;
        }
        found = true;

        uint32_t valid_len = sec.valid_len;
        if ((valid_len == 0) || (valid_len > kFooterIdOffset)) {
            valid_len = kFooterIdOffset;
        }

        if ((sec.offset + kSectionSize) > buffer.size()) {
            continue;
        }
        const uint16_t chk = ComputeSectionChecksum(&buffer[sec.offset], kFooterIdOffset, valid_len);
        WriteU16Le(&buffer[sec.offset], kFooterChecksumOffset, chk);
    }

    if (!found) {
        if (error != nullptr) {
            *error = "trainer section not found for checksum update";
        }
        return false;
    }
    return true;
}

// --- Public query utilities for other modules (Pc, Money, etc.) ---

int GetSpeciesGrowthRate(const int species_id) {
    const auto it = g_species_growth_rates.find(species_id);
    return (it != g_species_growth_rates.end()) ? it->second : -1;
}

int CalcLevelFromExp(const int growth_rate, const uint32_t exp) {
    for (int lvl = 1; lvl <= 100; ++lvl) {
        if (exp < ExpAtLevel(growth_rate, lvl + 1)) { return lvl; }
    }
    return 100;
}

uint32_t GetExpForLevel(const int growth_rate, const int level) {
    return ExpAtLevel(growth_rate, level);
}

int GetMoveBasePp(const int move_id) {
    const auto it = g_move_base_pp.find(move_id);
    return (it != g_move_base_pp.end()) ? it->second : 0;
}

int CalcMaxMovePp(const int move_id, const int pp_ups) {
    if (move_id <= 0) { return 0; }
    const int base = GetMoveBasePp(move_id);
    if (base <= 0) { return 0; }
    const int ups = std::clamp(pp_ups, 0, 3);
    return base + ((base * ups) / 5);
}

bool IsShinyFromOtidPid(const uint32_t otid, const uint32_t pid) {
    return IsShiny(otid, pid);
}

std::string GenderFromPidAndSpecies(const uint16_t species_id, const uint32_t pid) {
    return GenderFromPid(pid, GetGenderThreshold(species_id));
}

void RefreshPartyMonChecksums(std::vector<uint8_t> &buffer) {
    const auto sections = ListSections(buffer);
    for (const auto &sec : sections) {
        if (sec.section_id != kTrainerSectionId) { continue; }
        if ((sec.offset + kSectionSize) > buffer.size()) { continue; }
        uint8_t *trainer = &buffer[sec.offset];
        const uint32_t team_count = std::min(6U, ReadU32Le(trainer, kTeamCountOff));
        for (uint32_t i = 0; i < team_count; ++i) {
            const size_t mon_off = kPartyBaseOff + (i * kMonSize);
            if ((sec.offset + mon_off + kMonSize) > buffer.size()) { break; }
            WriteMonChecksum(trainer + mon_off);
        }
    }
}

} // namespace puse::core

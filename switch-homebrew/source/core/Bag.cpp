#include <puse/core/Bag.hpp>

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <fstream>
#include <regex>
#include <set>
#include <sstream>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include <puse/core/Binary.hpp>
#include <puse/core/SaveSections.hpp>
#include <puse/io/DataLoader.hpp>

namespace puse::core {

namespace {

// --- Constants (mirrors bag.py) ---
constexpr uint32_t kBagSectionSize        = 0x1000;
constexpr uint32_t kBagOffValidLen        = 0xFF0;
constexpr uint32_t kBagOffId             = 0xFF4;
constexpr uint32_t kBagOffChk            = 0xFF6;
constexpr uint32_t kBagOffSaveIdx        = 0xFFC;
constexpr uint16_t kUnboundItemSectorId  = 13;
constexpr uint32_t kUnboundItemFixedLen  = 0x450;
constexpr int      kMaxPlausibleItemId   = 4095;
constexpr int      kMaxPlausibleItemQty  = 2000;
constexpr int      kMaxSectorPocketSlots = static_cast<int>(kBagOffValidLen / 4);  // 1020
constexpr int      kMaxStrictPocketSlots = 80;
constexpr double   kMaxStrictDupRatio    = 0.35;
constexpr double   kMaxMediumDupRatio    = 0.60;
constexpr uint32_t kMinTrailerHeadroom   = 0x80;
constexpr uint32_t kEmptyBootstrapSlots  = 8;
constexpr uint32_t kKnownAnchorBall      = 0x1E31C;
constexpr uint32_t kKnownAnchorTm        = 0x1E3E4;
constexpr uint32_t kKnownAnchorBerry     = 0x1E5E4;
constexpr uint32_t kRelOffMain           = 0xAD8;
constexpr uint32_t kRelOffBall           = 0x31C;
constexpr uint32_t kRelOffTm             = 0x3E4;
constexpr uint32_t kRelOffBerry          = 0x5E4;
constexpr uint16_t kTmCaseItemId         = 364;
constexpr uint16_t kBerryPouchItemId     = 365;

const std::unordered_set<uint16_t> kBagSectorIds = {13, 14, 15, 16};

const std::vector<int> kMainProbeIds = {13, 84, 197, 94, 24, 26, 16, 493, 603, 606, 72};

// --- Pocket ID sets (loaded from item_pocket_map.json, hardcoded fallback) ---
std::unordered_set<uint16_t> g_ball_ids;
std::unordered_set<uint16_t> g_berry_ids;
std::unordered_set<uint16_t> g_tm_ids;
std::unordered_set<uint16_t> g_hm_ids;
std::unordered_set<uint16_t> g_tmhm_ids;
std::unordered_set<uint16_t> g_key_ids;
bool g_bag_data_loaded = false;

void LoadFallbackPocketSets() {
    g_ball_ids = {1,2,3,4,5,6,7,8,9,10,11,12,52,53,54,59,60,
                  622,623,624,625,626,627,628,629,630,631};
    g_berry_ids = {133,134,135,136,137,138,139,140,141,142,143,144,145,146,147,148,149,
                   150,151,152,153,154,155,156,157,158,159,160,161,162,163,164,165,166,
                   167,168,169,170,171,172,173,174,175,
                   539,540,541,542,543,544,545,546,547,548,549,550,551,552,553,554,555,
                   556,557,558,559,560,561,562};
    g_tm_ids = {289,290,291,292,293,294,295,296,297,298,299,300,301,302,303,304,305,306,
                307,308,309,310,311,312,313,314,315,316,317,318,319,320,321,322,323,324,
                325,326,327,328,329,330,331,332,333,334,335,336,337,338,339,340,341,342,
                343,344,345,346,
                375,376,377,378,379,380,381,382,383,384,385,386,387,388,389,390,391,392,
                393,394,395,396,397,398,399,400,401,402,403,404,405,406,407,408,409,410,
                411,412,413,414,415,416,417,418,419,420,421,422,423,424,425,426,427,428,
                429,430,431,432,433,434,435,436};
    g_hm_ids = {437,438,439,440,441,442,443,444};
    g_key_ids = {259,260,261,262,263,264,265,266,268,269,270,271,272,273,274,275,276,277,
                 278,279,280,281,282,283,284,285,286,287,288,
                 348,349,350,351,352,353,355,356,359,360,361,362,363,364,365,366,367,368,
                 369,370,371,372,373,374,
                 527,528,529,530,531,535,536,537,538,
                 632,633,655,656,657,658,659,660,661,662};
    g_tmhm_ids = g_tm_ids;
    for (auto id : g_hm_ids) { g_tmhm_ids.insert(id); }
}

std::vector<int> ParseIntArray(const std::string &text) {
    std::vector<int> out;
    size_t i = 0;
    while (i < text.size()) {
        while (i < text.size() && (text[i] == ' ' || text[i] == ',' || text[i] == '\n' || text[i] == '\r' || text[i] == '\t')) {
            ++i;
        }
        if (i >= text.size()) break;
        if (!std::isdigit(static_cast<unsigned char>(text[i]))) { ++i; continue; }
        int val = 0;
        while (i < text.size() && std::isdigit(static_cast<unsigned char>(text[i]))) {
            val = val * 10 + (text[i] - '0');
            ++i;
        }
        out.push_back(val);
    }
    return out;
}

bool ExtractPocketIds(const std::string &json, const std::string &pocket_name,
                      std::unordered_set<uint16_t> *out) {
    const std::regex pocket_re("\"" + pocket_name + "\"\\s*:\\s*\\{([^}]*)\\}");
    std::smatch pm;
    if (!std::regex_search(json, pm, pocket_re) || pm.size() < 2) {
        return false;
    }
    const std::string pocket_block = pm[1].str();
    const std::regex ids_re("\"ids\"\\s*:\\s*\\[([^\\]]*)\\]");
    std::smatch im;
    if (!std::regex_search(pocket_block, im, ids_re) || im.size() < 2) {
        return false;
    }
    const auto ids = ParseIntArray(im[1].str());
    if (ids.empty()) { return false; }
    out->clear();
    for (int id : ids) { out->insert(static_cast<uint16_t>(id)); }
    return true;
}

// --- Low-level slot helpers ---
void DecodeSlot(const std::vector<uint8_t> &buf, uint32_t off, bool swapped,
                uint16_t *item_id, uint16_t *qty) {
    const uint16_t a = ReadU16Le(buf.data(), off);
    const uint16_t b = ReadU16Le(buf.data(), off + 2);
    if (swapped) { *item_id = b; *qty = a; }
    else         { *item_id = a; *qty = b; }
}

bool IsPlausibleSlot(uint16_t item_id, uint16_t qty) {
    return (item_id >= 1) && (item_id <= kMaxPlausibleItemId) &&
           (qty >= 1) && (qty <= static_cast<uint16_t>(kMaxPlausibleItemQty));
}

// --- Pocket quality ---
int ScorePocket(int non_zero, int dups, int slots) {
    const int unique = std::max(0, non_zero - dups);
    const int dense  = std::min(unique, 64) * 6;
    const int over   = std::max(0, unique - 64);
    const int oversize_pen = std::max(0, slots - 64) * 10;
    const int dup_pen      = dups * 20;
    return dense + over - oversize_pen - dup_pen;
}

std::string ClassifyPocketQuality(int non_zero, int dups, int slots) {
    if (slots <= 0) { return "reject"; }
    const double ratio = static_cast<double>(dups) / static_cast<double>(slots);
    if (slots <= kMaxStrictPocketSlots && ratio <= kMaxStrictDupRatio) { return "strict"; }
    if (ratio <= kMaxMediumDupRatio) { return "medium"; }
    return "reject";
}

// --- Pocket bounds ---
struct PocketBounds {
    uint32_t start_abs;
    uint32_t end_abs;  // exclusive (first slot with item_id==0)
    int non_zero;
    int slot_count;
    int dup_count;
};

bool ExtractPocketBounds(const std::vector<uint8_t> &buf, uint32_t anchor_off, bool swapped,
                          PocketBounds *out) {
    if (anchor_off + 3 >= static_cast<uint32_t>(buf.size())) { return false; }
    const uint32_t sector_start = (anchor_off / kBagSectionSize) * kBagSectionSize;
    const uint32_t sector_end   = sector_start + kBagOffValidLen;
    if (!(sector_start <= anchor_off && anchor_off < sector_end)) { return false; }

    // Rewind to pocket start
    uint32_t curr = anchor_off;
    while (true) {
        if (curr < sector_start + 4) { break; }
        const uint32_t prev = curr - 4;
        uint16_t pid, pqty;
        DecodeSlot(buf, prev, swapped, &pid, &pqty);
        if (pid == 0 || !IsPlausibleSlot(pid, pqty)) { break; }
        curr = prev;
    }
    const uint32_t start_abs = curr;

    // Forward scan
    int non_zero = 0, dups = 0, slots = 0;
    std::unordered_set<uint16_t> seen;
    bool terminated = false;
    while ((curr + 3 < sector_end) && (slots < kMaxSectorPocketSlots)) {
        uint16_t iid, iqty;
        DecodeSlot(buf, curr, swapped, &iid, &iqty);
        if (iid == 0 || iqty == 0) { terminated = true; break; }
        if (!IsPlausibleSlot(iid, iqty)) { break; }
        ++slots; ++non_zero;
        if (seen.count(iid)) { ++dups; } else { seen.insert(iid); }
        curr += 4;
    }

    if (slots == 0 || !terminated) { return false; }
    out->start_abs  = start_abs;
    out->end_abs    = curr;
    out->non_zero   = non_zero;
    out->slot_count = slots;
    out->dup_count  = dups;
    return true;
}

bool BestPocketForAnchor(const std::vector<uint8_t> &buf, uint32_t anchor_off,
                         bool *out_swapped, PocketBounds *out_bounds) {
    int best_score = std::numeric_limits<int>::min();
    bool best_swapped = false;
    PocketBounds best{};
    bool found = false;

    for (bool sw : {false, true}) {
        PocketBounds b{};
        if (!ExtractPocketBounds(buf, anchor_off, sw, &b)) { continue; }
        const int s = ScorePocket(b.non_zero, b.dup_count, b.slot_count);
        if (!found || s > best_score) {
            best_score = s;
            best_swapped = sw;
            best = b;
            found = true;
        }
    }
    if (!found) { return false; }
    *out_swapped = best_swapped;
    *out_bounds  = best;
    return true;
}

// --- Item candidate (internal) ---
struct ItemCandidate {
    uint32_t offset;
    uint32_t pocket_end;
    int      sector_idx;
    uint16_t sect_id;
    uint32_t save_idx;
    int      pocket_slots;
    int      pocket_dups;
    int      pocket_nonzero;
    bool     encoding_swapped;
    int      score;
    std::string quality;
};

uint32_t ComputeActiveSaveIdx(const std::vector<uint8_t> &buf,
                               const std::unordered_set<uint16_t> &sector_ids) {
    uint32_t max_idx = 0;
    const size_t total = buf.size() / kBagSectionSize;
    for (size_t i = 0; i < total; ++i) {
        const uint32_t off = static_cast<uint32_t>(i * kBagSectionSize);
        const uint16_t sid = ReadU16Le(buf.data(), off + kBagOffId);
        if (!sector_ids.empty() && !sector_ids.count(sid)) { continue; }
        const uint32_t sidx = ReadU32Le(buf.data(), off + kBagOffSaveIdx);
        if (sidx == 0 || sidx == 0xFFFFFFFFU) { continue; }
        if (sidx > max_idx) { max_idx = sidx; }
    }
    if (max_idx > 0) { return max_idx; }
    // Fallback: scan all sectors
    for (size_t i = 0; i < total; ++i) {
        const uint32_t off = static_cast<uint32_t>(i * kBagSectionSize);
        const uint32_t sidx = ReadU32Le(buf.data(), off + kBagOffSaveIdx);
        if (sidx == 0 || sidx == 0xFFFFFFFFU) { continue; }
        if (sidx > max_idx) { max_idx = sidx; }
    }
    return max_idx;
}

std::vector<ItemCandidate> ScanForItemCandidates(const std::vector<uint8_t> &buf, uint16_t item_id) {
    if (item_id == 0) { return {}; }

    std::vector<ItemCandidate> strict_list, medium_list;
    const size_t total = buf.size() / kBagSectionSize;
    const uint32_t active_idx = ComputeActiveSaveIdx(buf, kBagSectorIds);

    for (size_t si = 0; si < total; ++si) {
        const uint32_t sec_off = static_cast<uint32_t>(si * kBagSectionSize);
        const uint16_t sect_id = ReadU16Le(buf.data(), sec_off + kBagOffId);
        const uint32_t save_idx = ReadU32Le(buf.data(), sec_off + kBagOffSaveIdx);
        if (!kBagSectorIds.count(sect_id)) { continue; }
        if (save_idx == 0) { continue; }

        for (uint32_t rel = 0; rel + 3 < kBagOffValidLen; rel += 2) {
            const uint32_t abs_off = sec_off + rel;
            if (rel >= (kBagOffValidLen - kMinTrailerHeadroom)) { continue; }

            for (bool sw : {false, true}) {
                uint16_t iid, qty;
                DecodeSlot(buf, abs_off, sw, &iid, &qty);
                if (iid != item_id || qty == 0) { continue; }
                if (!IsPlausibleSlot(iid, qty)) { continue; }

                PocketBounds b{};
                if (!ExtractPocketBounds(buf, abs_off, sw, &b)) { continue; }
                if (b.non_zero == 0) { continue; }
                if (b.slot_count < 2) { continue; }

                const int score = ScorePocket(b.non_zero, b.dup_count, b.slot_count);
                const std::string quality = ClassifyPocketQuality(b.non_zero, b.dup_count, b.slot_count);
                if (quality == "reject") { continue; }

                ItemCandidate c;
                c.offset          = b.start_abs;
                c.pocket_end      = b.end_abs;
                c.sector_idx      = static_cast<int>(si);
                c.sect_id         = sect_id;
                c.save_idx        = save_idx;
                c.pocket_slots    = b.slot_count;
                c.pocket_dups     = b.dup_count;
                c.pocket_nonzero  = b.non_zero;
                c.encoding_swapped = sw;
                c.score           = score;
                c.quality         = quality;

                if (quality == "strict") { strict_list.push_back(c); }
                else                     { medium_list.push_back(c); }
            }
        }
    }

    std::vector<ItemCandidate> all;
    all.insert(all.end(), strict_list.begin(), strict_list.end());
    all.insert(all.end(), medium_list.begin(), medium_list.end());

    // Dedup by (save_idx, sect_id, offset, encoding_swapped)
    std::unordered_map<std::string, size_t> best_by_key;
    for (size_t i = 0; i < all.size(); ++i) {
        const auto &c = all[i];
        const std::string key = std::to_string(c.save_idx) + "|" +
                                std::to_string(c.sect_id) + "|" +
                                std::to_string(c.offset) + "|" +
                                (c.encoding_swapped ? "1" : "0");
        auto it = best_by_key.find(key);
        if (it == best_by_key.end()) {
            best_by_key[key] = i;
        } else {
            const auto &prev = all[it->second];
            const int pr = (prev.quality == "strict") ? 2 : 1;
            const int nr = (c.quality == "strict") ? 2 : 1;
            if (std::make_tuple(nr, c.score, c.pocket_nonzero) >
                std::make_tuple(pr, prev.score, prev.pocket_nonzero)) {
                it->second = i;
            }
        }
    }

    std::vector<ItemCandidate> deduped;
    deduped.reserve(best_by_key.size());
    for (const auto &kv : best_by_key) { deduped.push_back(all[kv.second]); }

    // Family-specific max-pocket filter
    auto filter_family = [&](const std::unordered_set<uint16_t> &ids, int min_slots) {
        if (!ids.count(item_id)) { return; }
        std::vector<ItemCandidate> strict_fam;
        for (const auto &c : deduped) {
            if (c.quality == "strict") { strict_fam.push_back(c); }
        }
        if (strict_fam.empty()) { return; }
        const int max_slots = (*std::max_element(strict_fam.begin(), strict_fam.end(),
            [](const ItemCandidate &a, const ItemCandidate &b) {
                return a.pocket_slots < b.pocket_slots;
            })).pocket_slots;
        if (max_slots < min_slots) { return; }
        uint32_t max_idx = 0;
        for (const auto &c : strict_fam) {
            if (c.pocket_slots == max_slots && c.save_idx > max_idx) { max_idx = c.save_idx; }
        }
        deduped.erase(std::remove_if(deduped.begin(), deduped.end(), [&](const ItemCandidate &c) {
            return !(c.quality == "strict" && c.pocket_slots == max_slots && c.save_idx == max_idx);
        }), deduped.end());
    };
    filter_family(g_ball_ids, 8);
    filter_family(g_berry_ids, 12);
    filter_family(g_tm_ids, 20);

    std::sort(deduped.begin(), deduped.end(), [](const ItemCandidate &a, const ItemCandidate &b) {
        if (a.save_idx != b.save_idx) { return a.save_idx > b.save_idx; }
        const int qa = (a.quality == "strict") ? 0 : 1;
        const int qb = (b.quality == "strict") ? 0 : 1;
        if (qa != qb) { return qa < qb; }
        if (a.score != b.score) { return a.score > b.score; }
        return a.offset < b.offset;
    });
    return deduped;
}

std::vector<ItemCandidate> ScanGlobalIdSetPockets(const std::vector<uint8_t> &buf,
                                                   const std::unordered_set<uint16_t> &valid_ids,
                                                   int score_bonus,
                                                   int min_slots) {
    std::vector<ItemCandidate> out;
    if (valid_ids.empty()) { return out; }

    const size_t total = buf.size() / kBagSectionSize;
    const uint32_t active_idx = ComputeActiveSaveIdx(buf, kBagSectorIds);
    for (size_t si = 0; si < total; ++si) {
        const uint32_t sec_off = static_cast<uint32_t>(si * kBagSectionSize);
        const uint16_t sect_id = ReadU16Le(buf.data(), sec_off + kBagOffId);
        const uint32_t save_idx = ReadU32Le(buf.data(), sec_off + kBagOffSaveIdx);
        if (!kBagSectorIds.count(sect_id)) { continue; }
        if (save_idx == 0 || (active_idx > 0 && save_idx != active_idx)) { continue; }

        for (uint32_t rel = 0; rel + 3 < kBagOffValidLen; rel += 2) {
            const uint32_t abs_off = sec_off + rel;
            if (rel >= (kBagOffValidLen - kMinTrailerHeadroom)) { continue; }

            for (bool sw : {false, true}) {
                uint16_t iid, qty;
                DecodeSlot(buf, abs_off, sw, &iid, &qty);
                if (!valid_ids.count(iid) || qty == 0) { continue; }
                if (!IsPlausibleSlot(iid, qty)) { continue; }

                PocketBounds b{};
                if (!ExtractPocketBounds(buf, abs_off, sw, &b)) { continue; }
                if (b.non_zero < min_slots) { continue; }

                int family_hits = 0;
                uint32_t curr = b.start_abs;
                while (curr < b.end_abs && curr + 3 < static_cast<uint32_t>(buf.size())) {
                    uint16_t sid, sqty;
                    DecodeSlot(buf, curr, sw, &sid, &sqty);
                    if (sid == 0) { break; }
                    if (valid_ids.count(sid)) { ++family_hits; }
                    curr += 4;
                }
                const double purity = b.non_zero > 0 ? static_cast<double>(family_hits) / b.non_zero : 0.0;
                if (purity < 0.90) { continue; }

                const std::string quality = ClassifyPocketQuality(b.non_zero, b.dup_count, b.slot_count);
                if (quality == "reject") { continue; }

                ItemCandidate c;
                c.offset = b.start_abs;
                c.pocket_end = b.end_abs;
                c.sector_idx = static_cast<int>(si);
                c.sect_id = sect_id;
                c.save_idx = save_idx;
                c.pocket_slots = b.slot_count;
                c.pocket_dups = b.dup_count;
                c.pocket_nonzero = b.non_zero;
                c.encoding_swapped = sw;
                c.score = ScorePocket(b.non_zero, b.dup_count, b.slot_count) + score_bonus;
                c.quality = quality;
                out.push_back(c);
            }
        }
    }

    std::sort(out.begin(), out.end(), [](const ItemCandidate &a, const ItemCandidate &b) {
        if (a.save_idx != b.save_idx) { return a.save_idx > b.save_idx; }
        const int qa = (a.quality == "strict") ? 0 : 1;
        const int qb = (b.quality == "strict") ? 0 : 1;
        if (qa != qb) { return qa < qb; }
        if (a.score != b.score) { return a.score > b.score; }
        return a.offset < b.offset;
    });
    return out;
}

struct QuickPocketResult {
    bool found = false;
    uint32_t anchor_offset = 0;
    std::string quality;
    int score = 0;
    int slot_count = 0;
    int dup_count = 0;
    std::string source;
    std::string confidence;
};

// Try a static/known anchor; return QuickPocketResult.
QuickPocketResult TryStaticAnchor(const std::vector<uint8_t> &buf, uint32_t anchor,
                                   const std::unordered_set<uint16_t> &family_ids,
                                   int min_slots, const std::string &pocket_type) {
    QuickPocketResult r;
    if (anchor + 3 >= static_cast<uint32_t>(buf.size())) { return r; }

    bool sw; PocketBounds b{};
    if (!BestPocketForAnchor(buf, anchor, &sw, &b)) { return r; }
    if (b.slot_count == 0) { return r; }
    const std::string quality = ClassifyPocketQuality(b.non_zero, b.dup_count, b.slot_count);
    if (quality == "reject") { return r; }

    // Count family hits
    int hits = 0;
    uint32_t curr = b.start_abs;
    while (curr < b.end_abs && curr + 3 < static_cast<uint32_t>(buf.size())) {
        uint16_t iid, iqty;
        DecodeSlot(buf, curr, sw, &iid, &iqty);
        if (iid == 0) { break; }
        if (family_ids.count(iid)) { ++hits; }
        curr += 4;
    }

    const int score = ScorePocket(b.non_zero, b.dup_count, b.slot_count);
    const double purity = (b.slot_count > 0) ? static_cast<double>(hits) / b.slot_count : 0.0;

    // Sparse ball: accept if >= 2 slots, strict, family purity high
    if (pocket_type == "ball" && b.slot_count >= 2 && b.slot_count < min_slots && quality == "strict") {
        r.found = true; r.anchor_offset = anchor; r.quality = quality;
        r.score = score; r.slot_count = b.slot_count; r.dup_count = b.dup_count;
        r.source = "validated_sparse"; r.confidence = "medium";
        return r;
    }

    if (b.slot_count >= min_slots && hits >= std::max(min_slots - 2, static_cast<int>(b.slot_count * 0.7))) {
        r.found = true; r.anchor_offset = anchor; r.quality = quality;
        r.score = score; r.slot_count = b.slot_count; r.dup_count = b.dup_count;
        r.source = "validated_static"; r.confidence = "high";
        return r;
    }

    const int sparse_floor = (pocket_type == "ball") ? 2 : std::max(4, min_slots / 3);
    if (b.slot_count >= sparse_floor && purity >= 0.90) {
        r.found = true; r.anchor_offset = anchor; r.quality = quality;
        r.score = score; r.slot_count = b.slot_count; r.dup_count = b.dup_count;
        r.source = "validated_sparse";
        r.confidence = (b.slot_count >= min_slots / 2) ? "medium" : "low";
        return r;
    }
    return r;
}

QuickPocketResult ResolveMainPocket(const std::vector<uint8_t> &buf) {
    QuickPocketResult r;
    // Try active section 13
    const size_t total = buf.size() / kBagSectionSize;
    uint32_t best_save_idx = 0;
    uint32_t best_sec_off = 0;
    bool found_sec = false;
    for (size_t i = 0; i < total; ++i) {
        const uint32_t off = static_cast<uint32_t>(i * kBagSectionSize);
        const uint16_t sid = ReadU16Le(buf.data(), off + kBagOffId);
        const uint32_t sidx = ReadU32Le(buf.data(), off + kBagOffSaveIdx);
        if (sid == kUnboundItemSectorId && sidx > best_save_idx) {
            best_save_idx = sidx;
            best_sec_off  = off;
            found_sec     = true;
        }
    }

    if (found_sec) {
        const uint32_t anchor = best_sec_off + kRelOffMain;
        bool sw; PocketBounds b{};
        if (BestPocketForAnchor(buf, anchor, &sw, &b) && b.slot_count > 0) {
            const std::string quality = ClassifyPocketQuality(b.non_zero, b.dup_count, b.slot_count);
            if (quality != "reject") {
                r.found = true; r.anchor_offset = anchor; r.quality = quality;
                r.score = ScorePocket(b.non_zero, b.dup_count, b.slot_count);
                r.slot_count = b.slot_count; r.dup_count = b.dup_count;
                r.source = "active_section_template";
                r.confidence = (quality == "strict") ? "high" : "medium";
                return r;
            }
        }
    }

    // Probe fallback
    QuickPocketResult best;
    int best_probe = 0;
    for (int probe_id : kMainProbeIds) {
        const auto candidates = ScanForItemCandidates(buf, static_cast<uint16_t>(probe_id));
        if (candidates.empty()) { continue; }
        const auto &top = candidates[0];
        const bool strict_good = (top.quality == "strict" && top.pocket_slots >= 6);
        if (!best.found) {
            best.found = true; best.anchor_offset = top.offset;
            best.quality = top.quality; best.score = top.score;
            best.slot_count = top.pocket_slots; best.dup_count = top.pocket_dups;
            best.source = std::string("scan_probe:") + std::to_string(probe_id);
            best.confidence = (top.quality == "strict") ? "high" : "medium";
            best_probe = probe_id;
            if (strict_good) { break; }
        } else {
            if (std::make_tuple(top.save_idx, top.quality == "strict" ? 1 : 0, top.score) >
                std::make_tuple(
                    static_cast<uint32_t>(0), best.quality == "strict" ? 1 : 0, best.score)) {
                best.anchor_offset = top.offset; best.quality = top.quality;
                best.score = top.score; best.slot_count = top.pocket_slots;
                best.dup_count = top.pocket_dups;
                best.source = std::string("scan_probe:") + std::to_string(probe_id);
                best.confidence = (top.quality == "strict") ? "high" : "medium";
                best_probe = probe_id;
            }
        }
    }
    (void)best_probe;
    return best;
}

QuickPocketResult ResolveFamilyPocket(const std::vector<uint8_t> &buf,
                                       bool has_known_anchor, uint32_t known_anchor,
                                       uint16_t probe_id,
                                       const std::unordered_set<uint16_t> &family_ids,
                                       int min_slots,
                                       const std::string &pocket_type) {
    QuickPocketResult r;

    if (has_known_anchor) {
        r = TryStaticAnchor(buf, known_anchor, family_ids, min_slots, pocket_type);
        if (r.found) { return r; }
    }

    // Probe scan fallback
    const auto candidates = ScanForItemCandidates(buf, probe_id);
    if (!candidates.empty()) {
        const auto &top = candidates[0];
        r.found = true; r.anchor_offset = top.offset; r.quality = top.quality;
        r.score = top.score; r.slot_count = top.pocket_slots; r.dup_count = top.pocket_dups;
        r.source = std::string("scan_fallback");
        r.confidence = (top.quality == "strict") ? "high" : "medium";
        return r;
    }

    const int sparse_floor = std::max(4, min_slots / 3);
    const int score_bonus = pocket_type == "key" ? 520 : (pocket_type == "tm" ? 480 : 450);
    const auto sparse = ScanGlobalIdSetPockets(buf, family_ids, score_bonus, sparse_floor);
    if (!sparse.empty()) {
        const auto &top = sparse[0];
        r.found = true; r.anchor_offset = top.offset; r.quality = top.quality;
        r.score = top.score; r.slot_count = top.pocket_slots; r.dup_count = top.pocket_dups;
        r.source = "global_idset_scan";
        r.confidence = (top.quality == "strict") ? "medium" : "low";
        return r;
    }
    return r;
}

std::unordered_set<uint16_t> ExtractKeyItemIds(const std::vector<uint8_t> &buf,
                                                const QuickPocketResult &key_pocket) {
    std::unordered_set<uint16_t> out;
    if (!key_pocket.found) { return out; }
    const auto slots = MapPocketFromAnchor(buf, key_pocket.anchor_offset);
    for (const auto &s : slots) {
        if (s.item_id != 0) { out.insert(s.item_id); }
    }
    return out;
}

bool AnchorRegionIsEmpty(const std::vector<uint8_t> &buf, uint32_t anchor) {
    if (anchor == 0) { return false; }
    const uint32_t end = anchor + kEmptyBootstrapSlots * 4;
    if (end > static_cast<uint32_t>(buf.size())) { return false; }
    for (uint32_t i = 0; i < kEmptyBootstrapSlots; ++i) {
        const uint32_t off = anchor + i * 4;
        if (ReadU16Le(buf.data(), off) != 0 || ReadU16Le(buf.data(), off + 2) != 0) { return false; }
    }
    return true;
}

BagPocket MakePocketFromResult(const std::string &type, const QuickPocketResult &r,
                                bool ready, bool locked, uint16_t req_key,
                                const std::string &locked_reason,
                                bool is_empty = false) {
    BagPocket p;
    p.pocket_type = type;
    p.anchor_offset = r.anchor_offset;
    p.quality = r.found ? r.quality : "unavailable";
    p.slot_count = r.slot_count;
    p.dup_count = r.dup_count;
    p.source = r.source;
    p.confidence = r.confidence;
    p.ready = ready;
    p.locked = locked;
    p.requires_key_item = req_key;
    p.locked_reason = locked_reason;
    p.is_empty_candidate = is_empty;
    return p;
}

BagPocket GateUnlockablePocket(const std::vector<uint8_t> &buf,
                                const std::string &pocket_type,
                                const QuickPocketResult &raw,
                                uint16_t required_item,
                                const std::unordered_set<uint16_t> &key_ids_present,
                                uint32_t template_base_off,
                                uint32_t rel_off) {
    if (raw.found && raw.slot_count > 0) {
        return MakePocketFromResult(pocket_type, raw, true, false, required_item, "");
    }

    if (key_ids_present.count(required_item)) {
        QuickPocketResult candidate = raw;
        if (!candidate.found && template_base_off != 0) {
            const uint32_t anchor = template_base_off + rel_off;
            if (AnchorRegionIsEmpty(buf, anchor)) {
                candidate.found = true;
                candidate.anchor_offset = anchor;
                candidate.quality = "empty";
                candidate.slot_count = 0;
                candidate.source = "empty_unlocked";
                candidate.confidence = "low";
            }
        }
        if (candidate.found) {
            return MakePocketFromResult(pocket_type, candidate, true, false, required_item,
                                       "", candidate.quality == "empty");
        }
    }

    return MakePocketFromResult(pocket_type, raw, false, true, required_item,
                               "missing_unlock_key_item");
}

} // namespace

// --- Public API ---

bool EnsureBagDataLoaded(std::string *error) {
    if (g_bag_data_loaded) { return true; }

    const std::string path = io::ResolveAssetPath("data/item_pocket_map.json");
    bool loaded = false;
    if (!path.empty()) {
        std::ifstream in(path);
        if (in.good()) {
            std::ostringstream ss;
            ss << in.rdbuf();
            const std::string json = ss.str();

            std::unordered_set<uint16_t> ball, berry, tm, hm, key;
            const bool ok = ExtractPocketIds(json, "ball", &ball) &&
                            ExtractPocketIds(json, "berry", &berry) &&
                            ExtractPocketIds(json, "tm", &tm) &&
                            ExtractPocketIds(json, "hm", &hm) &&
                            ExtractPocketIds(json, "key", &key);
            if (ok && !ball.empty() && !berry.empty() && !tm.empty() && !key.empty()) {
                g_ball_ids  = ball;
                g_berry_ids = berry;
                g_tm_ids    = tm;
                g_hm_ids    = hm;
                g_key_ids   = key;
                g_tmhm_ids  = tm;
                for (auto id : hm) { g_tmhm_ids.insert(id); }
                loaded = true;
            }
        }
    }

    if (!loaded) {
        LoadFallbackPocketSets();
    }

    g_bag_data_loaded = true;
    return true;
}

std::unordered_map<std::string, BagPocket> ResolveQuickPockets(const std::vector<uint8_t> &buf) {
    std::unordered_map<std::string, BagPocket> out;

    // Main
    const auto main_r = ResolveMainPocket(buf);
    {
        BagPocket p;
        p.pocket_type = "main";
        p.anchor_offset = main_r.anchor_offset;
        p.quality = main_r.found ? main_r.quality : "unavailable";
        p.slot_count = main_r.slot_count; p.dup_count = main_r.dup_count;
        p.source = main_r.source; p.confidence = main_r.confidence;
        p.ready = main_r.found;
        p.locked = false;
        out["main"] = p;
    }

    // Ball
    const auto ball_r = ResolveFamilyPocket(buf, true, kKnownAnchorBall, 4,
                                             g_ball_ids, 8, "ball");
    {
        BagPocket p;
        p.pocket_type = "ball"; p.anchor_offset = ball_r.anchor_offset;
        p.quality = ball_r.found ? ball_r.quality : "unavailable";
        p.slot_count = ball_r.slot_count; p.dup_count = ball_r.dup_count;
        p.source = ball_r.source; p.confidence = ball_r.confidence;
        p.ready = ball_r.found; p.locked = false;
        out["ball"] = p;
    }

    // Key
    const auto key_r = ResolveFamilyPocket(buf, false, 0, 368, g_key_ids, 4, "key");
    {
        BagPocket p;
        p.pocket_type = "key"; p.anchor_offset = key_r.anchor_offset;
        p.quality = key_r.found ? key_r.quality : "unavailable";
        p.slot_count = key_r.slot_count; p.dup_count = key_r.dup_count;
        p.source = key_r.source; p.confidence = key_r.confidence;
        p.ready = key_r.found; p.locked = false;
        out["key"] = p;
    }

    // Get key items present + template base
    const auto key_ids_present = ExtractKeyItemIds(buf, key_r);
    uint32_t template_base_off = 0;
    if (key_r.found) {
        template_base_off = (key_r.anchor_offset / kBagSectionSize) * kBagSectionSize;
    } else {
        // Fallback to known ball anchor base
        template_base_off = kKnownAnchorBall - kRelOffBall;
    }

    // TM (gated)
    const auto tm_raw = ResolveFamilyPocket(buf, true, kKnownAnchorTm, 307, g_tmhm_ids, 20, "tm");
    out["tm"] = GateUnlockablePocket(buf, "tm", tm_raw, kTmCaseItemId,
                                      key_ids_present, template_base_off, kRelOffTm);

    // Berry (gated)
    const auto berry_raw = ResolveFamilyPocket(buf, true, kKnownAnchorBerry, 149,
                                                g_berry_ids, 12, "berry");
    out["berry"] = GateUnlockablePocket(buf, "berry", berry_raw, kBerryPouchItemId,
                                         key_ids_present, template_base_off, kRelOffBerry);

    return out;
}

std::vector<BagSlot> MapPocketFromAnchor(const std::vector<uint8_t> &buf, uint32_t anchor_off) {
    bool sw; PocketBounds b{};
    if (!BestPocketForAnchor(buf, anchor_off, &sw, &b)) { return {}; }

    std::vector<BagSlot> out;
    uint32_t curr = b.start_abs;
    while (curr < b.end_abs && curr + 3 < static_cast<uint32_t>(buf.size())) {
        uint16_t iid, iqty;
        DecodeSlot(buf, curr, sw, &iid, &iqty);
        if (iid == 0) { break; }
        if (!IsPlausibleSlot(iid, iqty)) { break; }
        out.push_back({iid, iqty, curr, sw});
        curr += 4;
    }

    // Append up to 3 empty slots for add-item flow
    const uint32_t sector_start = (b.start_abs / kBagSectionSize) * kBagSectionSize;
    const uint32_t sector_end = sector_start + kBagOffValidLen;
    int empties = 0;
    while (curr + 3 < sector_end && empties < 3) {
        uint16_t iid, iqty;
        DecodeSlot(buf, curr, sw, &iid, &iqty);
        if (iid != 0) { break; }
        out.push_back({0, 0, curr, sw});
        ++empties;
        curr += 4;
    }
    return out;
}

void WriteSlot(std::vector<uint8_t> &buf, uint32_t offset, uint16_t item_id, uint16_t qty,
               bool encoding_swapped) {
    if (offset + 3 >= static_cast<uint32_t>(buf.size())) { return; }
    // TM/HM/Key: force qty >= 1
    if ((g_tmhm_ids.count(item_id) || g_key_ids.count(item_id)) && qty == 0) { qty = 1; }
    if (encoding_swapped) {
        WriteU16Le(buf.data(), offset,     qty);
        WriteU16Le(buf.data(), offset + 2, item_id);
    } else {
        WriteU16Le(buf.data(), offset,     item_id);
        WriteU16Le(buf.data(), offset + 2, qty);
    }
}

bool CommitBagSectorChecksums(std::vector<uint8_t> &buf, std::string *error) {
    const size_t total = buf.size() / kBagSectionSize;
    bool any = false;
    for (size_t i = 0; i < total; ++i) {
        const uint32_t off = static_cast<uint32_t>(i * kBagSectionSize);
        const uint16_t sid = ReadU16Le(buf.data(), off + kBagOffId);
        if (!kBagSectorIds.count(sid)) { continue; }
        const uint32_t save_idx = ReadU32Le(buf.data(), off + kBagOffSaveIdx);
        if (save_idx == 0) { continue; }

        uint32_t valid_len;
        if (sid == kUnboundItemSectorId) {
            valid_len = kUnboundItemFixedLen;
        } else {
            valid_len = ReadU32Le(buf.data(), off + kBagOffValidLen);
            if (valid_len == 0 || valid_len > kBagOffId) { valid_len = kBagOffId; }
        }

        const uint16_t chk = ComputeSectionChecksum(buf.data() + off, kBagOffId, valid_len);
        WriteU16Le(buf.data(), off + kBagOffChk, chk);
        any = true;
    }
    if (!any && error != nullptr) { *error = "no bag sectors found"; }
    return any;
}

std::string PocketTypeForItemId(uint16_t item_id) {
    if (g_key_ids.count(item_id))   { return "key"; }
    if (g_ball_ids.count(item_id))  { return "ball"; }
    if (g_berry_ids.count(item_id)) { return "berry"; }
    if (g_tm_ids.count(item_id))    { return "tm"; }
    if (g_hm_ids.count(item_id))    { return "hm"; }
    return "generic";
}

const std::unordered_set<uint16_t> &GetTmHmItemIds() { return g_tmhm_ids; }
const std::unordered_set<uint16_t> &GetKeyItemIds()  { return g_key_ids; }

std::vector<uint16_t> CollectOwnedTmHmItemIds(const std::vector<uint8_t> &buf, bool *tm_case_owned) {
    EnsureBagDataLoaded(nullptr);
    const auto pockets = ResolveQuickPockets(buf);
    const auto it = pockets.find("tm");
    const bool owned_case = (it != pockets.end()) && !it->second.locked;
    if (tm_case_owned != nullptr) {
        *tm_case_owned = owned_case;
    }

    std::unordered_set<uint16_t> owned;
    if (owned_case && it != pockets.end()) {
        for (const auto &slot : MapPocketFromAnchor(buf, it->second.anchor_offset)) {
            if ((slot.item_id > 0) && (slot.qty > 0) && (g_tmhm_ids.count(slot.item_id) != 0U)) {
                owned.insert(slot.item_id);
            }
        }
    }

    std::vector<uint16_t> out(owned.begin(), owned.end());
    std::sort(out.begin(), out.end());
    return out;
}

} // namespace puse::core

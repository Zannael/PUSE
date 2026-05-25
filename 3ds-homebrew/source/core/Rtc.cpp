#include <puse/core/Rtc.hpp>
#include <puse/core/Binary.hpp>
#include <puse/core/SaveSections.hpp>

#include <algorithm>
#include <cstdio>
#include <cstring>
#include <string>
#include <sys/stat.h>
#include <unordered_set>

namespace {

// ---- Minimal JSON parser (subset: objects, arrays, integers, strings) --------

static void SkipWs(const std::string &s, size_t &pos) {
    while (pos < s.size() && (s[pos]==' '||s[pos]=='\t'||s[pos]=='\n'||s[pos]=='\r')) pos++;
}

static bool ParseInt64(const std::string &s, size_t &pos, int64_t *out) {
    SkipWs(s, pos);
    if (pos >= s.size()) return false;
    bool neg = (s[pos] == '-');
    if (neg) pos++;
    if (pos >= s.size() || s[pos] < '0' || s[pos] > '9') return false;
    int64_t v = 0;
    while (pos < s.size() && s[pos] >= '0' && s[pos] <= '9') v = v*10 + (s[pos++]-'0');
    *out = neg ? -v : v;
    return true;
}

static bool ParseString(const std::string &s, size_t &pos, std::string *out) {
    SkipWs(s, pos);
    if (pos >= s.size() || s[pos] != '"') return false;
    pos++;
    out->clear();
    while (pos < s.size() && s[pos] != '"') {
        if (s[pos] == '\\') { pos++; if (pos < s.size()) { out->push_back(s[pos]); pos++; } }
        else { out->push_back(s[pos++]); }
    }
    if (pos < s.size()) pos++;
    return true;
}

// Find end of balanced { } or [ ] block (s[pos] must be '{' or '[').
static size_t FindBlockEnd(const std::string &s, size_t pos) {
    if (pos >= s.size()) return std::string::npos;
    const char open = s[pos], close = (open == '{' ? '}' : ']');
    int depth = 0;
    bool in_str = false;
    for (size_t i = pos; i < s.size(); ++i) {
        if (in_str) {
            if (s[i] == '\\') { ++i; continue; }
            if (s[i] == '"') in_str = false;
        } else {
            if (s[i] == '"') { in_str = true; continue; }
            if (s[i] == open) ++depth;
            else if (s[i] == close && --depth == 0) return i;
        }
    }
    return std::string::npos;
}

// Find value start position for a key inside [from, end).
static size_t FindKey(const std::string &s, const std::string &key, size_t from, size_t end) {
    const std::string pat = "\"" + key + "\"";
    size_t pos = s.find(pat, from);
    if (pos == std::string::npos || pos >= end) return std::string::npos;
    pos += pat.size();
    SkipWs(s, pos);
    if (pos >= end || s[pos] != ':') return std::string::npos;
    pos++;
    SkipWs(s, pos);
    return pos;
}

static bool GetInt64Field(const std::string &s, const std::string &key,
                          size_t from, size_t end, int64_t *val) {
    size_t vpos = FindKey(s, key, from, end);
    if (vpos == std::string::npos) return false;
    return ParseInt64(s, vpos, val);
}

static bool ParseIntArray(const std::string &s, size_t pos, std::vector<int> *out) {
    SkipWs(s, pos);
    if (pos >= s.size() || s[pos] != '[') return false;
    const size_t end = FindBlockEnd(s, pos);
    if (end == std::string::npos) return false;
    pos++;
    out->clear();
    while (pos < end) {
        SkipWs(s, pos);
        if (pos >= end || s[pos] == ']') break;
        int64_t v;
        if (!ParseInt64(s, pos, &v)) break;
        out->push_back(static_cast<int>(v));
        SkipWs(s, pos);
        if (pos < end && s[pos] == ',') pos++;
    }
    return true;
}

// ---- Save section helpers ---------------------------------------------------

constexpr size_t kRtcSectSz   = 0x1000;
constexpr size_t kRtcPayloadSz = 0xFF0;
constexpr size_t kRtcBodyLen   = 0x20000;

static const std::unordered_set<uint16_t> kOpaqueIds = {0, 4, 13};

struct RtcSection {
    size_t   off;
    uint16_t sid;
    uint32_t save_idx;
    uint32_t valid_len;
    uint16_t checksum;
};

static std::unordered_map<uint16_t, RtcSection> LatestBySecId(const std::vector<uint8_t> &buf) {
    std::unordered_map<uint16_t, RtcSection> out;
    const size_t body = std::min(buf.size(), kRtcBodyLen);
    for (size_t off = 0; off + kRtcSectSz <= body; off += kRtcSectSz) {
        RtcSection s{};
        s.off       = off;
        s.sid       = puse::core::ReadU16Le(buf.data(), off + 0xFF4);
        s.save_idx  = puse::core::ReadU32Le(buf.data(), off + 0xFFC);
        s.valid_len = puse::core::ReadU32Le(buf.data(), off + 0xFF0);
        s.checksum  = puse::core::ReadU16Le(buf.data(), off + 0xFF6);
        auto it = out.find(s.sid);
        if (it == out.end() || s.save_idx > it->second.save_idx) out[s.sid] = s;
    }
    return out;
}

static void RecalcChecksumAt(std::vector<uint8_t> &buf, size_t off, uint32_t valid_len) {
    if (off + kRtcSectSz > buf.size()) return;
    uint32_t vlen = valid_len;
    if (vlen == 0 || vlen > 0xFF4) vlen = 0xFF4;
    const uint16_t chk = puse::core::ComputeSectionChecksum(buf.data() + off, 0xFF4, vlen);
    puse::core::WriteU16Le(buf.data(), off + 0xFF6, chk);
}

// Mirrors compute_layout_offset_for_saveidx() from rtc_repair_from_pair.py
static size_t ComputeLayoutOffset(uint16_t sid, uint32_t save_idx) {
    const size_t base_block = (save_idx % 2 == 0) ? 0 : 14;
    const size_t rel = (static_cast<size_t>(sid) + (save_idx % 14)) % 14;
    return (base_block + rel) * kRtcSectSz;
}

} // anonymous namespace

namespace puse::core {

// ---- Profile order constants ------------------------------------------------

const char *kQuickProfileOrder[3] = {
    "quick_id0_id4",
    "quick_id0_id4_id13",
    "quick_id0_id4_id13_aux12",
};

const char *kPairProfileOrder[7] = {
    "control",
    "id0_full",
    "id0_id13_full",
    "id0_id4_full",
    "id0_id4_id13_full",
    "id0_full_plus_aux12",
    "id0_id4_id13_full_plus_aux12",
};

// ---- LoadRtcManifest --------------------------------------------------------

bool LoadRtcManifest(const std::string &path, RtcManifest *out, std::string *error) {
    FILE *fp = std::fopen(path.c_str(), "rb");
    if (!fp) {
        if (error) *error = "Cannot open: " + path;
        return false;
    }
    std::fseek(fp, 0, SEEK_END);
    const long sz = std::ftell(fp);
    std::fseek(fp, 0, SEEK_SET);
    if (sz <= 0) { std::fclose(fp); if (error) *error = "Empty manifest"; return false; }

    std::string json(static_cast<size_t>(sz), '\0');
    const size_t read = std::fread(json.data(), 1, static_cast<size_t>(sz), fp);
    std::fclose(fp);
    if (static_cast<long>(read) != sz) { if (error) *error = "Read error"; return false; }

    out->loaded = false;
    out->changes_by_id.clear();
    out->profiles.clear();

    // format
    {
        int64_t v = 0;
        GetInt64Field(json, "format", 0, json.size(), &v);
        out->format = static_cast<int>(v);
    }

    // changes_by_id
    {
        size_t cpos = FindKey(json, "changes_by_id", 0, json.size());
        if (cpos == std::string::npos || json[cpos] != '{') {
            if (error) *error = "Missing changes_by_id";
            return false;
        }
        const size_t cend = FindBlockEnd(json, cpos);
        if (cend == std::string::npos) { if (error) *error = "Unclosed changes_by_id"; return false; }

        size_t pos = cpos + 1;
        while (pos < cend) {
            SkipWs(json, pos);
            if (pos >= cend || json[pos] == '}') break;

            std::string sid_str;
            if (!ParseString(json, pos, &sid_str)) break;
            SkipWs(json, pos);
            if (pos >= cend || json[pos] != ':') break;
            pos++;
            SkipWs(json, pos);
            if (pos >= cend || json[pos] != '{') break;

            const size_t sec_end = FindBlockEnd(json, pos);
            if (sec_end == std::string::npos) break;

            const int sid_int = std::stoi(sid_str);
            RtcSectionEntry entry{};
            entry.sid = sid_int;
            int64_t v;
            if (GetInt64Field(json, "sid", pos, sec_end, &v)) entry.sid = static_cast<int>(v);

            // broken_latest
            {
                size_t blpos = FindKey(json, "broken_latest", pos, sec_end);
                if (blpos != std::string::npos && blpos < sec_end && json[blpos] == '{') {
                    const size_t blend = FindBlockEnd(json, blpos);
                    if (blend != std::string::npos) {
                        if (GetInt64Field(json, "save_idx", blpos, blend, &v)) entry.broken_save_idx = static_cast<uint32_t>(v);
                        if (GetInt64Field(json, "checksum", blpos, blend, &v)) entry.broken_checksum = static_cast<uint16_t>(v);
                    }
                }
            }

            // fixed_latest
            {
                size_t flpos = FindKey(json, "fixed_latest", pos, sec_end);
                if (flpos != std::string::npos && flpos < sec_end && json[flpos] == '{') {
                    const size_t flend = FindBlockEnd(json, flpos);
                    if (flend != std::string::npos) {
                        if (GetInt64Field(json, "save_idx", flpos, flend, &v)) entry.fixed_save_idx = static_cast<uint32_t>(v);
                        if (GetInt64Field(json, "checksum", flpos, flend, &v)) entry.fixed_checksum = static_cast<uint16_t>(v);
                    }
                }
            }

            if (GetInt64Field(json, "count", pos, sec_end, &v)) entry.count = static_cast<int>(v);

            // changes array
            {
                size_t apos = FindKey(json, "changes", pos, sec_end);
                if (apos != std::string::npos && apos < sec_end && json[apos] == '[') {
                    const size_t aend = FindBlockEnd(json, apos);
                    if (aend != std::string::npos) {
                        size_t epos = apos + 1;
                        while (epos < aend) {
                            SkipWs(json, epos);
                            if (epos >= aend || json[epos] == ']') break;
                            if (json[epos] == '{') {
                                const size_t eend = FindBlockEnd(json, epos);
                                if (eend == std::string::npos) break;
                                RtcChange ch{};
                                if (GetInt64Field(json, "rel_off", epos, eend, &v)) ch.rel_off = static_cast<int>(v);
                                if (GetInt64Field(json, "from",    epos, eend, &v)) ch.from_byte = static_cast<uint8_t>(v);
                                if (GetInt64Field(json, "to",      epos, eend, &v)) ch.to_byte   = static_cast<uint8_t>(v);
                                entry.changes.push_back(ch);
                                epos = eend + 1;
                            } else { epos++; }
                            SkipWs(json, epos);
                            if (epos < aend && json[epos] == ',') epos++;
                        }
                    }
                }
            }

            out->changes_by_id[sid_int] = std::move(entry);
            pos = sec_end + 1;
            SkipWs(json, pos);
            if (pos < cend && json[pos] == ',') pos++;
        }
    }

    // profiles
    {
        size_t ppos = FindKey(json, "profiles", 0, json.size());
        if (ppos != std::string::npos && ppos < json.size() && json[ppos] == '{') {
            const size_t pend = FindBlockEnd(json, ppos);
            if (pend != std::string::npos) {
                size_t pos = ppos + 1;
                while (pos < pend) {
                    SkipWs(json, pos);
                    if (pos >= pend || json[pos] == '}') break;
                    std::string prof_name;
                    if (!ParseString(json, pos, &prof_name)) break;
                    SkipWs(json, pos);
                    if (pos >= pend || json[pos] != ':') break;
                    pos++;
                    SkipWs(json, pos);
                    std::vector<int> ids;
                    if (ParseIntArray(json, pos, &ids)) {
                        out->profiles[prof_name] = ids;
                        const size_t aend = FindBlockEnd(json, pos);
                        if (aend != std::string::npos) pos = aend + 1;
                        else break;
                    } else { pos++; }
                    SkipWs(json, pos);
                    if (pos < pend && json[pos] == ',') pos++;
                }
            }
        }
    }

    out->loaded = !out->changes_by_id.empty();
    return out->loaded;
}

// ---- BuildQuickCandidates ---------------------------------------------------

static const std::vector<std::pair<std::string, std::vector<int>>> kQuickProfiles = {
    {"quick_id0_id4",            {0, 4}},
    {"quick_id0_id4_id13",       {0, 4, 13}},
    {"quick_id0_id4_id13_aux12", {0, 4, 13, 1, 2}},
};

bool BuildQuickCandidates(const std::vector<uint8_t> &tampered,
                          const RtcManifest &manifest,
                          RtcQuickResult *out,
                          std::string *error)
{
    if (!manifest.loaded) { if (error) *error = "Manifest not loaded"; return false; }
    if (tampered.size() < kRtcBodyLen) { if (error) *error = "Save too small"; return false; }

    const auto src_latest = LatestBySecId(tampered);

    uint32_t source_idx = 0;
    for (int s = 0; s < 14; s++) {
        auto it = src_latest.find(static_cast<uint16_t>(s));
        if (it != src_latest.end() && it->second.save_idx > source_idx) source_idx = it->second.save_idx;
    }
    const uint32_t target_idx = source_idx + 1;
    out->source_idx = source_idx;
    out->target_idx = target_idx;
    out->candidates.clear();

    // Build coherent base at target_idx
    std::vector<uint8_t> base(tampered);
    std::unordered_map<uint16_t, size_t> dst_off_map;

    for (int sid = 0; sid < 14; sid++) {
        auto it = src_latest.find(static_cast<uint16_t>(sid));
        if (it == src_latest.end()) {
            if (error) *error = "Missing section id=" + std::to_string(sid);
            return false;
        }
        const auto &src = it->second;
        const size_t so  = src.off;
        const size_t doff = ComputeLayoutOffset(static_cast<uint16_t>(sid), target_idx);

        if (doff + kRtcSectSz > base.size()) base.resize(doff + kRtcSectSz, 0);

        std::copy(tampered.begin() + so,
                  tampered.begin() + so + kRtcPayloadSz,
                  base.begin() + doff);
        std::copy(tampered.begin() + so + kRtcPayloadSz,
                  tampered.begin() + so + kRtcSectSz,
                  base.begin() + doff + kRtcPayloadSz);

        WriteU16Le(base.data(), doff + 0xFF4, static_cast<uint16_t>(sid));
        WriteU32Le(base.data(), doff + 0xFFC, target_idx);

        if (kOpaqueIds.count(static_cast<uint16_t>(sid))) {
            WriteU16Le(base.data(), doff + 0xFF6, src.checksum);
        } else {
            const uint32_t vlen = ReadU32Le(base.data(), doff + 0xFF0);
            RecalcChecksumAt(base, doff, vlen);
        }
        dst_off_map[static_cast<uint16_t>(sid)] = doff;
    }

    // Build each quick-fix candidate
    for (const auto &[name, sids] : kQuickProfiles) {
        std::vector<uint8_t> cand(base);
        for (int sid : sids) {
            const auto mit = manifest.changes_by_id.find(sid);
            if (mit == manifest.changes_by_id.end()) continue;
            const auto dit = dst_off_map.find(static_cast<uint16_t>(sid));
            if (dit == dst_off_map.end()) continue;
            const size_t doff = dit->second;
            for (const auto &ch : mit->second.changes) {
                if (doff + static_cast<size_t>(ch.rel_off) < cand.size()) {
                    cand[doff + ch.rel_off] = ch.to_byte;
                }
            }
            if (kOpaqueIds.count(static_cast<uint16_t>(sid))) {
                uint16_t fixed_chk = mit->second.fixed_checksum;
                if (fixed_chk == 0) {
                    auto sit = src_latest.find(static_cast<uint16_t>(sid));
                    if (sit != src_latest.end()) fixed_chk = sit->second.checksum;
                }
                WriteU16Le(cand.data(), doff + 0xFF6, fixed_chk);
            } else {
                const uint32_t vlen = ReadU32Le(cand.data(), doff + 0xFF0);
                RecalcChecksumAt(cand, doff, vlen);
            }
        }
        out->candidates[name] = std::move(cand);
    }
    return true;
}

// ---- BuildPairCandidates helpers -------------------------------------------

// Mirrors build_manifest() from rtc_patch.py
static RtcManifest BuildManifestFromPair(const std::vector<uint8_t> &broken,
                                          const std::vector<uint8_t> &fixed)
{
    RtcManifest manifest;
    const auto b_latest = LatestBySecId(broken);
    const auto f_latest = LatestBySecId(fixed);

    for (int sid = 0; sid < 14; sid++) {
        auto bit = b_latest.find(static_cast<uint16_t>(sid));
        auto fit = f_latest.find(static_cast<uint16_t>(sid));
        if (bit == b_latest.end() || fit == f_latest.end()) continue;

        const size_t boff = bit->second.off;
        const size_t foff = fit->second.off;

        std::vector<RtcChange> changes;
        for (int rel = 0; rel < static_cast<int>(kRtcPayloadSz); rel++) {
            const uint8_t bv = broken[boff + rel];
            const uint8_t fv = fixed[foff + rel];
            if (bv != fv) changes.push_back({rel, bv, fv});
        }
        if (!changes.empty()) {
            RtcSectionEntry entry{};
            entry.sid            = sid;
            entry.broken_save_idx = bit->second.save_idx;
            entry.broken_checksum = bit->second.checksum;
            entry.fixed_save_idx  = fit->second.save_idx;
            entry.fixed_checksum  = fit->second.checksum;
            entry.count           = static_cast<int>(changes.size());
            entry.changes         = std::move(changes);
            manifest.changes_by_id[sid] = std::move(entry);
        }
    }

    std::vector<int> aux_ids;
    for (const auto &[k, _] : manifest.changes_by_id) {
        if (k != 0) aux_ids.push_back(k);
    }
    std::sort(aux_ids.begin(), aux_ids.end());
    std::vector<int> core_plus = {0};
    core_plus.insert(core_plus.end(), aux_ids.begin(), aux_ids.end());
    manifest.profiles["core_only"]     = {0};
    manifest.profiles["core_plus_aux"] = core_plus;
    manifest.loaded = true;
    return manifest;
}

// Section source (0=broken, 1=fixed) and aux patch IDs per profile.
// Mirrors build_candidate() logic from rtc_repair_from_pair.py
static void ProfileConfig(const std::string &profile,
                           std::unordered_map<int,int> &src_map,
                           std::vector<int> &patch_ids)
{
    for (int s = 0; s < 14; s++) src_map[s] = 0;
    patch_ids.clear();
    if      (profile == "control")                          { /* all broken */ }
    else if (profile == "id0_full")                         { src_map[0]=1; }
    else if (profile == "id0_id13_full")                    { src_map[0]=1; src_map[13]=1; }
    else if (profile == "id0_id4_full")                     { src_map[0]=1; src_map[4]=1; }
    else if (profile == "id0_id4_id13_full")                { src_map[0]=1; src_map[4]=1; src_map[13]=1; }
    else if (profile == "id0_full_plus_aux12")              { src_map[0]=1; patch_ids={1,2}; }
    else if (profile == "id0_id4_id13_full_plus_aux12")     { src_map[0]=1; src_map[4]=1; src_map[13]=1; patch_ids={1,2}; }
}

static std::vector<std::string> VerifyCandidate(const std::vector<uint8_t> &cand,
                                                  const std::unordered_map<uint16_t, RtcSection> &f_latest)
{
    std::vector<std::string> issues;
    const auto c_latest = LatestBySecId(cand);

    uint32_t target_idx = 0;
    for (int s = 0; s < 14; s++) {
        auto it = f_latest.find(static_cast<uint16_t>(s));
        if (it != f_latest.end() && it->second.save_idx > target_idx) target_idx = it->second.save_idx;
    }

    for (int sid = 0; sid < 14; sid++) {
        auto cit = c_latest.find(static_cast<uint16_t>(sid));
        auto fit = f_latest.find(static_cast<uint16_t>(sid));
        if (cit == c_latest.end() || fit == f_latest.end()) {
            issues.push_back("missing sid=" + std::to_string(sid)); continue;
        }
        if (cit->second.save_idx != target_idx)
            issues.push_back("sid=" + std::to_string(sid) + " wrong save_idx");
        if (cit->second.off != fit->second.off)
            issues.push_back("sid=" + std::to_string(sid) + " wrong offset");
        if (kOpaqueIds.count(static_cast<uint16_t>(sid)) == 0) {
            const size_t off = cit->second.off;
            const uint32_t vlen = cit->second.valid_len;
            const uint16_t calc   = ComputeSectionChecksum(cand.data() + off, 0xFF4, vlen);
            const uint16_t stored = ReadU16Le(cand.data(), off + 0xFF6);
            if (calc != stored)
                issues.push_back("sid=" + std::to_string(sid) + " checksum mismatch");
        }
    }
    return issues;
}

bool BuildPairCandidates(const std::vector<uint8_t> &broken,
                         const std::vector<uint8_t> &fixed,
                         RtcPairResult *out,
                         std::string *error)
{
    if (broken.size() < kRtcBodyLen || fixed.size() < kRtcBodyLen) {
        if (error) *error = "Save file too small";
        return false;
    }

    out->manifest = BuildManifestFromPair(broken, fixed);
    const auto &manifest = out->manifest;
    const auto b_latest  = LatestBySecId(broken);
    const auto f_latest  = LatestBySecId(fixed);

    uint32_t target_idx = 0;
    for (int s = 0; s < 14; s++) {
        auto it = f_latest.find(static_cast<uint16_t>(s));
        if (it != f_latest.end() && it->second.save_idx > target_idx) target_idx = it->second.save_idx;
    }

    for (int pi = 0; pi < 7; pi++) {
        const std::string profile = kPairProfileOrder[pi];
        std::unordered_map<int,int> src_map;
        std::vector<int> patch_ids;
        ProfileConfig(profile, src_map, patch_ids);

        std::vector<uint8_t> cand(broken);
        if (cand.size() < fixed.size()) cand.resize(fixed.size(), 0);

        for (int sid = 0; sid < 14; sid++) {
            const bool use_fixed = (src_map[sid] == 1);
            const auto &src_latest_map = use_fixed ? f_latest : b_latest;
            const auto &src_buf        = use_fixed ? fixed    : broken;

            auto dsit  = f_latest.find(static_cast<uint16_t>(sid));
            auto srcit = src_latest_map.find(static_cast<uint16_t>(sid));
            if (dsit == f_latest.end() || srcit == src_latest_map.end()) continue;

            const size_t doff = dsit->second.off;
            const size_t soff = srcit->second.off;

            std::copy(src_buf.begin() + soff,
                      src_buf.begin() + soff + kRtcPayloadSz,
                      cand.begin() + doff);
            std::copy(src_buf.begin() + soff + kRtcPayloadSz,
                      src_buf.begin() + soff + kRtcSectSz,
                      cand.begin() + doff + kRtcPayloadSz);

            WriteU16Le(cand.data(), doff + 0xFF4, static_cast<uint16_t>(sid));
            WriteU32Le(cand.data(), doff + 0xFFC, target_idx);

            if (kOpaqueIds.count(static_cast<uint16_t>(sid))) {
                WriteU16Le(cand.data(), doff + 0xFF6, srcit->second.checksum);
            } else {
                const uint32_t vlen = ReadU32Le(cand.data(), doff + 0xFF0);
                RecalcChecksumAt(cand, doff, vlen);
            }
        }

        // Apply aux patch ids
        for (int sid : patch_ids) {
            auto chit = manifest.changes_by_id.find(sid);
            if (chit == manifest.changes_by_id.end()) continue;
            auto dsit = f_latest.find(static_cast<uint16_t>(sid));
            if (dsit == f_latest.end()) continue;
            const size_t doff = dsit->second.off;
            for (const auto &ch : chit->second.changes) {
                if (doff + static_cast<size_t>(ch.rel_off) < cand.size())
                    cand[doff + ch.rel_off] = ch.to_byte;
            }
            if (kOpaqueIds.count(static_cast<uint16_t>(sid)) == 0) {
                const uint32_t vlen = ReadU32Le(cand.data(), doff + 0xFF0);
                RecalcChecksumAt(cand, doff, vlen);
            }
        }

        RtcCandidateInfo info;
        info.bytes  = cand;
        info.issues = VerifyCandidate(cand, f_latest);
        out->candidates[profile] = std::move(info);
    }

    return true;
}

// ---- WriteRtcCandidates -----------------------------------------------------

int WriteRtcCandidates(const std::unordered_map<std::string, std::vector<uint8_t>> &candidates,
                       const char *const *profile_order, int profile_count,
                       std::string *error)
{
    const std::string dir = "sdmc:/3ds/puse/rtc";
    mkdir(dir.c_str(), 0777); // create if absent; ignore error if already exists

    int written = 0;
    for (int i = 0; i < profile_count; i++) {
        const std::string name = profile_order[i];
        const auto it = candidates.find(name);
        if (it == candidates.end()) continue;

        const std::string path = dir + "/candidate_" + name + ".sav";
        FILE *fp = std::fopen(path.c_str(), "wb");
        if (!fp) {
            if (error && written == 0) *error = "Cannot write to " + dir + "/ (check SD card)";
            continue;
        }
        std::fwrite(it->second.data(), 1, it->second.size(), fp);
        std::fclose(fp);
        written++;
    }
    return written;
}

} // namespace puse::core

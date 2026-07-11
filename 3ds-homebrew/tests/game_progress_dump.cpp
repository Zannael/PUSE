#include <iostream>
#include <sstream>
#include <string>

#include <puse/core/GameProgress.hpp>
#include <puse/core/SaveSession.hpp>

namespace {

std::string JoinIds(const std::vector<uint16_t> &ids) {
    std::ostringstream ss;
    for (size_t i = 0; i < ids.size(); ++i) {
        if (i != 0) { ss << '|'; }
        ss << ids[i];
    }
    return ss.str();
}

void PrintSnapshot(const puse::core::GameProgressSnapshot &s) {
    std::cout << s.badge_count << ','
              << s.active_level_cap << ','
              << s.normal_level_cap << ','
              << s.expert_level_cap << ','
              << s.cap_profile << ','
              << s.effective_level_cap << ','
              << (s.difficulty_flag_known ? 1 : 0) << ','
              << (s.is_champion ? 1 : 0) << ','
              << (s.mega_unlocked ? 1 : 0) << ','
              << s.money << ','
              << s.battle_points << ','
              << (s.tm_case_owned ? 1 : 0) << ','
              << JoinIds(s.owned_tmhm_item_ids) << ','
              << (s.dexnav ? 1 : 0) << ','
              << (s.stat_scanner ? 1 : 0) << ','
              << (s.mega_ring ? 1 : 0) << ','
              << s.heart_scale << ','
              << s.dream_mist << ','
              << s.bottle_cap << ','
              << s.gold_bottle_cap << '\n';
}

} // namespace

int main(int argc, char **argv) {
    if (argc < 2) {
        std::cerr << "Usage: game_progress_dump <save_file>" << std::endl;
        return 1;
    }

    puse::core::SaveSession session;
    std::string error;
    if (!session.LoadFromFile(argv[1], &error)) {
        std::cerr << "load failed: " << error << std::endl;
        return 2;
    }

    for (const std::string profile : {"normal", "expert"}) {
        puse::core::GameProgressSnapshot snapshot;
        if (!puse::core::BuildGameProgressSnapshot(session.Buffer(), profile, &snapshot, &error)) {
            std::cerr << "snapshot failed: " << error << std::endl;
            return 3;
        }
        PrintSnapshot(snapshot);
    }
    return 0;
}

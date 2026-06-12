#include <3ds.h>

#include <algorithm>
#include <cstdio>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

#include <puse/core/Party.hpp>
#include <puse/core/SaveSession.hpp>
#include <puse/io/DataLoader.hpp>

namespace {

const char* kSaveCandidates[] = {
    "sdmc:/3ds/puse/Unbound.sav",
    "sdmc:/3ds/open_agb_firm/saves/Unbound.sav",
    "sdmc:/3ds/openagbfw/saves/Unbound.sav",
    "sdmc:/Unbound.sav",
};

enum class View {
    PartyList,
    Sections,
    SummaryQuick,
};

enum class SectionKind {
    Summary,
    Battle,
    Training,
    Moves,
};

const char* SectionName(SectionKind s) {
    switch (s) {
        case SectionKind::Summary: return "Summary";
        case SectionKind::Battle: return "Battle";
        case SectionKind::Training: return "Training";
        case SectionKind::Moves: return "Moves";
    }
    return "Summary";
}

bool FileExists(const char* path) {
    FILE* fp = std::fopen(path, "rb");
    if (fp == nullptr) return false;
    std::fclose(fp);
    return true;
}

std::string FindSavePath() {
    for (const char* p : kSaveCandidates) {
        if (FileExists(p)) return p;
    }
    return "";
}

void DrawPartyList(const std::vector<puse::core::PartyEntry>& party, int cursor, bool loaded, const std::string& status) {
    consoleClear();
    std::printf("PUSE 3DS SAFE MODE\n");
    std::printf("(direct console renderer)\n\n");

    if (!loaded) {
        std::printf("Save not loaded.\n\n");
        std::printf("Expected:\n");
        std::printf("- sdmc:/3ds/puse/Unbound.sav\n");
        std::printf("- sdmc:/3ds/open_agb_firm/saves/Unbound.sav\n");
        std::printf("\nSTART: Exit\n");
        if (!status.empty()) std::printf("\n%s\n", status.c_str());
        return;
    }

    std::printf("Party %d/6\n", static_cast<int>(party.size()));
    std::printf("UP/DOWN: Select  A: Open  X: Save  START: Exit\n\n");

    for (int i = 0; i < 6; ++i) {
        const puse::core::PartyEntry* mon = nullptr;
        for (const auto& e : party) {
            if (e.index == i) {
                mon = &e;
                break;
            }
        }

        if (i == cursor) std::printf("> ");
        else std::printf("  ");

        if (mon == nullptr) {
            std::printf("#%d (empty)\n", i + 1);
        } else {
            std::printf("#%d %-12s Lv%-3d %-10s\n", i + 1, mon->species_name.c_str(), static_cast<int>(mon->level), mon->nature_name.c_str());
        }
    }

    if (cursor >= 0 && cursor < 6) {
        for (const auto& e : party) {
            if (e.index == cursor) {
                std::printf("\nSelected: %s / %s\n", e.nickname.c_str(), e.species_name.c_str());
                std::printf("Ability: %s\n", e.effective_ability_name.c_str());
                break;
            }
        }
    }

    if (!status.empty()) std::printf("\n%s\n", status.c_str());
}

void DrawSections(const puse::core::PartyEntry* mon, int cursor, const std::string& status) {
    consoleClear();
    std::printf("PUSE 3DS SAFE MODE\n");
    std::printf("Sections\n\n");

    if (mon == nullptr) {
        std::printf("Selected slot empty\n");
        std::printf("B: Back\n");
        return;
    }

    std::printf("%s / %s\n", mon->nickname.c_str(), mon->species_name.c_str());
    std::printf("Lv %d  %s  %s\n\n", static_cast<int>(mon->level), mon->nature_name.c_str(), mon->gender.c_str());

    const SectionKind items[] = {SectionKind::Summary, SectionKind::Battle, SectionKind::Training, SectionKind::Moves};
    for (int i = 0; i < 4; ++i) {
        std::printf(i == cursor ? "> %s\n" : "  %s\n", SectionName(items[i]));
    }

    std::printf("\nA: Open  B: Back  X: Save\n");
    if (!status.empty()) std::printf("\n%s\n", status.c_str());
}

void DrawSummaryQuick(const puse::core::PartyEntry* mon, const std::string& status) {
    consoleClear();
    std::printf("PUSE 3DS SAFE MODE\n");
    std::printf("Summary Quick Edit\n\n");

    if (mon == nullptr) {
        std::printf("Selected slot empty\n");
        std::printf("B: Back\n");
        return;
    }

    std::printf("%s / %s\n", mon->nickname.c_str(), mon->species_name.c_str());
    std::printf("Level: %d\n", static_cast<int>(mon->level));
    std::printf("Nature: %s\n", mon->nature_name.c_str());
    std::printf("Ability: %s\n", mon->effective_ability_name.c_str());
    std::printf("Shiny: %s\n", mon->is_shiny ? "YES" : "no");
    std::printf("\nLEFT/RIGHT: Level -/+\n");
    std::printf("A: Toggle shiny  B: Back  X: Save\n");
    if (!status.empty()) std::printf("\n%s\n", status.c_str());
}

const puse::core::PartyEntry* FindSlot(const std::vector<puse::core::PartyEntry>& party, int slot) {
    for (const auto& e : party) {
        if (e.index == slot) return &e;
    }
    return nullptr;
}

bool SaveNow(puse::core::SaveSession& session, const std::string& path, std::string* status) {
    puse::core::RefreshPartyMonChecksums(session.MutableBuffer());
    if (!puse::core::CommitPartySectionChecksums(session.MutableBuffer())) {
        if (status) *status = "Checksum commit failed";
        return false;
    }

    const std::string bak = path + ".bak";
    std::remove(bak.c_str());
    std::rename(path.c_str(), bak.c_str());

    std::string err;
    if (!session.ExportToFile(path, &err)) {
        std::rename(bak.c_str(), path.c_str());
        if (status) *status = "Save failed: " + err;
        return false;
    }
    if (status) *status = "Saved";
    return true;
}

} // namespace

int main() {
    gfxInitDefault();
    consoleInit(GFX_TOP, nullptr);
    romfsInit();

    std::unordered_map<int, std::string> species_db;
    std::string status;
    bool loaded = false;
    bool dirty = false;
    int cursor = 0;
    int section_cursor = 0;
    int slot = 0;
    View view = View::PartyList;
    std::vector<puse::core::PartyEntry> party;

    const std::string save_path = FindSavePath();
    puse::core::SaveSession session;

        if (save_path.empty()) {
        status = "Unbound.sav not found";
    } else {
        std::string err;
        if (!session.LoadFromFile(save_path, &err)) {
            status = "Load failed: " + err;
        } else if (!puse::core::EnsurePartyStaticDataLoaded(&err)) {
            status = "Data failed: " + err;
        } else {
            std::string sp = puse::io::ResolveAssetPath("data/pokemon.txt");
            if (!sp.empty()) species_db = puse::io::LoadIdNameFile(sp);
            party = puse::core::ParseParty(session.Buffer(), species_db);
            loaded = true;
            status = "Loaded: " + save_path;
        }
    }

    hidSetRepeatParameters(18, 5);

    while (aptMainLoop()) {
        hidScanInput();
        u32 down = hidKeysDown();
        u32 held = hidKeysHeld();

        if (down & KEY_START) break;

        if (loaded && (down & KEY_X)) {
            SaveNow(session, save_path, &status);
            dirty = false;
            party = puse::core::ParseParty(session.Buffer(), species_db);
        }

        if (loaded) {
            if (view == View::PartyList) {
                if (down & KEY_UP) cursor = std::max(0, cursor - 1);
                if (down & KEY_DOWN) cursor = std::min(5, cursor + 1);
                if (down & KEY_A) {
                    slot = cursor;
                    section_cursor = 0;
                    view = View::Sections;
                }
            } else if (view == View::Sections) {
                if (down & KEY_B) view = View::PartyList;
                if (down & KEY_UP) section_cursor = std::max(0, section_cursor - 1);
                if (down & KEY_DOWN) section_cursor = std::min(3, section_cursor + 1);
                if (down & KEY_A) {
                    if (section_cursor == 0) {
                        view = View::SummaryQuick;
                    } else {
                        status = "Section not yet ported in safe mode";
                    }
                }
            } else if (view == View::SummaryQuick) {
                if (down & KEY_B) view = View::Sections;
                const auto* mon = FindSlot(party, slot);
                if (mon != nullptr) {
                    if ((down & KEY_LEFT) || ((held & KEY_LEFT) && (hidKeysDownRepeat() & KEY_LEFT))) {
                        int lv = std::max(1, static_cast<int>(mon->level) - 1);
                        puse::core::PartyLevelResult res{};
                        std::string err;
                        if (puse::core::UpdatePartyLevel(session.MutableBuffer(), slot, lv, mon->species_growth_rate, &res, &err)) {
                            puse::core::CommitPartySectionChecksums(session.MutableBuffer());
                            party = puse::core::ParseParty(session.Buffer(), species_db);
                            dirty = true;
                            status = "Level updated";
                        } else {
                            status = "Level update failed: " + err;
                        }
                    }
                    if ((down & KEY_RIGHT) || ((held & KEY_RIGHT) && (hidKeysDownRepeat() & KEY_RIGHT))) {
                        int lv = std::min(100, static_cast<int>(mon->level) + 1);
                        puse::core::PartyLevelResult res{};
                        std::string err;
                        if (puse::core::UpdatePartyLevel(session.MutableBuffer(), slot, lv, mon->species_growth_rate, &res, &err)) {
                            puse::core::CommitPartySectionChecksums(session.MutableBuffer());
                            party = puse::core::ParseParty(session.Buffer(), species_db);
                            dirty = true;
                            status = "Level updated";
                        } else {
                            status = "Level update failed: " + err;
                        }
                    }
                    if (down & KEY_A) {
                        std::string err;
                        if (puse::core::UpdatePartyIdentity(session.MutableBuffer(), slot, !mon->is_shiny, std::nullopt, &err)) {
                            puse::core::CommitPartySectionChecksums(session.MutableBuffer());
                            party = puse::core::ParseParty(session.Buffer(), species_db);
                            dirty = true;
                            status = "Shiny toggled";
                        } else {
                            status = "Shiny update failed: " + err;
                        }
                    }
                }
            }
        }

        std::string draw_status = status;
        if (dirty) {
            if (!draw_status.empty()) draw_status += " | ";
            draw_status += "UNSAVED";
        }

        if (!loaded || view == View::PartyList) {
            DrawPartyList(party, cursor, loaded, draw_status);
        } else if (view == View::Sections) {
            DrawSections(FindSlot(party, slot), section_cursor, draw_status);
        } else {
            DrawSummaryQuick(FindSlot(party, slot), draw_status);
        }

        gfxFlushBuffers();
        gfxSwapBuffers();
        gspWaitForVBlank();
    }

    romfsExit();
    gfxExit();
    return 0;
}

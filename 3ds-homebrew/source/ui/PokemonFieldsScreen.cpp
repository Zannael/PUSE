#include "ui/PokemonFieldsScreen.h"
#include "Core.h"

#include "starlight/InputManager.h"
#include "starlight/datatypes/Color.h"
#include "starlight/datatypes/VRect.h"
#include "starlight/datatypes/Vector2.h"
#include "starlight/dialog/osk/InputHandler.h"

#include <puse/core/Party.hpp>

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <algorithm>
#include <optional>

using sl::Color;
using sl::VRect;
using sl::Vector2;
using starlight::InputManager;
using starlight::dialog::osk::InputHandlerBuffered;

static constexpr int kRowH  = 36;
static constexpr int kRowW  = 316;
static constexpr int kRowX  = 2;
static constexpr int kRowY0 = 2;

static const char* kStatNames[6] = {"HP","Atk","Def","SpA","SpD","Spe"};

namespace puse::ui {

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

PokemonFieldsScreen::PokemonFieldsScreen(int slot, Section section)
    : BaseScreen(false), slot_(slot), section_(section)
{
    Core* core = Core::Get();

    std::string footer = "B: Back   X: Save";
    if (section_ == Section::Training && core && core->LegitMode())
        footer = "B: Back   [Legit]   X: Save";
    InitChrome(footer);

    // Top preview
    preview_label_ = topScreen->AddNew<sl::ui::Label>(VRect(0, 35, 400, 200));
    preview_label_->SetPreset("normal.12");
    preview_label_->textConfig->justification = Vector2::half;
    preview_label_->textConfig->borderColor = Color::black;

    // Scrollable field list on bottom
    scroll_ = touchScreen->AddNew<sl::ui::ScrollField>(VRect(0, 0, 320, 218));

    LoadEntry();

    switch (section_) {
        case Section::Summary:  BuildSummaryFields();  break;
        case Section::Battle:   BuildBattleFields();   break;
        case Section::Training: BuildTrainingFields(); break;
        case Section::Moves:    BuildMovesFields();    break;
    }

    RefreshPreview();
}

std::shared_ptr<PokemonFieldsScreen> PokemonFieldsScreen::Make(int slot, Section section) {
    return std::make_shared<PokemonFieldsScreen>(slot, section);
}

// ---------------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------------

void PokemonFieldsScreen::LoadEntry() {
    Core* core = Core::Get();
    if (!core || !core->Session().IsLoaded()) return;
    auto party = puse::core::ParseParty(core->Session().Buffer(), core->SpeciesDb());
    for (auto& e : party) {
        if (e.index == slot_) { entry_ = e; return; }
    }
}

std::string PokemonFieldsScreen::NameOrId(const std::unordered_map<int, std::string>& db, int id) const {
    auto it = db.find(id);
    if (it != db.end()) return it->second;
    return std::to_string(id);
}

void PokemonFieldsScreen::CommitAndRefresh() {
    Core* core = Core::Get();
    if (!core) return;
    puse::core::CommitPartySectionChecksums(core->Session().MutableBuffer());
    core->SetDirty(true);
    LoadEntry();
    RefreshFields();
    RefreshPreview();
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

std::shared_ptr<sl::ui::Button> PokemonFieldsScreen::AddField(int y) {
    auto btn = scroll_->AddNew<sl::ui::Button>(VRect(kRowX, y, kRowW, kRowH - 2));
    field_btns_.push_back(btn);
    return btn;
}

void PokemonFieldsScreen::RefreshPreview() {
    if (!preview_label_) return;
    static const char* kSectionNames[] = {"Summary","Battle","Training","Moves"};
    char buf[300];
    snprintf(buf, sizeof(buf),
        "[%s]  %s / %s\n"
        "Lv.%d   %s   %s\n"
        "%s%s",
        kSectionNames[(int)section_],
        entry_.nickname.empty() ? "???" : entry_.nickname.c_str(),
        entry_.species_name.empty() ? "???" : entry_.species_name.c_str(),
        (int)entry_.level,
        entry_.nature_name.c_str(),
        entry_.gender.c_str(),
        entry_.is_shiny ? "[Shiny]   " : "",
        entry_.effective_ability_name.c_str());
    preview_label_->SetText(buf);
}

// ---------------------------------------------------------------------------
// Summary section
// ---------------------------------------------------------------------------

void PokemonFieldsScreen::BuildSummaryFields() {
    int y = kRowY0;

    // 0: Nickname
    {
        auto btn = AddField(y); y += kRowH;
        btn->eOnTap = [this](sl::ui::Button&) {
            Core* core = Core::Get();
            if (!core) return;
            InputManager::OpenKeyboard(new InputHandlerBuffered(
                entry_.nickname, false,
                [this, core](const std::string& s) {
                    std::string err;
                    if (puse::core::UpdatePartyNickname(
                            core->Session().MutableBuffer(), slot_, s, &err))
                        CommitAndRefresh();
                }));
        };
    }
    // 1: Species
    {
        auto btn = AddField(y); y += kRowH;
        btn->eOnTap = [this](sl::ui::Button&) {
            Core* core = Core::Get();
            if (!core) return;
            InputManager::OpenKeyboard(new InputHandlerBuffered(
                std::to_string(entry_.species_id), false,
                [this, core](const std::string& s) {
                    int id = std::atoi(s.c_str());
                    if (id <= 0) return;
                    std::string err;
                    if (puse::core::UpdatePartySpecies(
                            core->Session().MutableBuffer(), slot_,
                            static_cast<uint16_t>(id), &err))
                        CommitAndRefresh();
                }));
        };
    }
    // 2: Level
    {
        auto btn = AddField(y); y += kRowH;
        btn->eOnTap = [this](sl::ui::Button&) {
            Core* core = Core::Get();
            if (!core) return;
            InputManager::OpenKeyboard(new InputHandlerBuffered(
                std::to_string(entry_.level), false,
                [this, core](const std::string& s) {
                    int lv = std::atoi(s.c_str());
                    if (lv < 1 || lv > 100) return;
                    puse::core::PartyLevelResult res{};
                    std::string err;
                    if (puse::core::UpdatePartyLevel(
                            core->Session().MutableBuffer(), slot_, lv,
                            entry_.species_growth_rate, &res, &err))
                        CommitAndRefresh();
                }));
        };
    }
    // 3: Nature (cycle on tap)
    {
        auto btn = AddField(y); y += kRowH;
        btn->eOnTap = [this](sl::ui::Button&) {
            Core* core = Core::Get();
            if (!core) return;
            uint8_t next = static_cast<uint8_t>((entry_.nature_id + 1) % 25);
            std::string err;
            if (puse::core::UpdatePartyNature(
                    core->Session().MutableBuffer(), slot_, next, &err))
                CommitAndRefresh();
        };
    }
    // 4: Shiny (toggle)
    {
        auto btn = AddField(y); y += kRowH;
        btn->eOnTap = [this](sl::ui::Button&) {
            Core* core = Core::Get();
            if (!core) return;
            bool next = !entry_.is_shiny;
            std::string err;
            if (puse::core::UpdatePartyIdentity(
                    core->Session().MutableBuffer(), slot_,
                    next, std::nullopt, &err))
                CommitAndRefresh();
        };
    }
    // 5: Gender (toggle if editable)
    {
        auto btn = AddField(y); y += kRowH;
        btn->eOnTap = [this](sl::ui::Button&) {
            if (!entry_.gender_editable) return;
            Core* core = Core::Get();
            if (!core) return;
            std::string next = (entry_.gender == "M") ? "F" : "M";
            std::string err;
            if (puse::core::UpdatePartyIdentity(
                    core->Session().MutableBuffer(), slot_,
                    std::nullopt, next, &err))
                CommitAndRefresh();
        };
    }

    RefreshFields();
}

// ---------------------------------------------------------------------------
// Battle section
// ---------------------------------------------------------------------------

void PokemonFieldsScreen::BuildBattleFields() {
    int y = kRowY0;

    // 0: Item
    {
        auto btn = AddField(y); y += kRowH;
        btn->eOnTap = [this](sl::ui::Button&) {
            Core* core = Core::Get();
            if (!core) return;
            InputManager::OpenKeyboard(new InputHandlerBuffered(
                std::to_string(entry_.item_id), false,
                [this, core](const std::string& s) {
                    int id = std::atoi(s.c_str());
                    if (id < 0) return;
                    std::string err;
                    if (puse::core::UpdatePartyItem(
                            core->Session().MutableBuffer(), slot_,
                            static_cast<uint16_t>(id), &err))
                        CommitAndRefresh();
                }));
        };
    }
    // 1: Ability (cycle: 0→1→2→0)
    {
        auto btn = AddField(y); y += kRowH;
        btn->eOnTap = [this](sl::ui::Button&) {
            Core* core = Core::Get();
            if (!core) return;
            int next = (entry_.current_ability_index + 1) % 3;
            std::string err;
            if (puse::core::UpdatePartyAbilitySwitch(
                    core->Session().MutableBuffer(), slot_, next, &err))
                CommitAndRefresh();
        };
    }

    RefreshFields();
}

// ---------------------------------------------------------------------------
// Training section (IVs + EVs)
// ---------------------------------------------------------------------------

void PokemonFieldsScreen::BuildTrainingFields() {
    int y = kRowY0;

    // 0-5: IVs
    for (int i = 0; i < 6; ++i) {
        auto btn = AddField(y); y += kRowH;
        btn->eOnTap = [this, i](sl::ui::Button&) {
            Core* core = Core::Get();
            if (!core) return;
            InputManager::OpenKeyboard(new InputHandlerBuffered(
                std::to_string(entry_.ivs[i]), false,
                [this, core, i](const std::string& s) {
                    int v = std::atoi(s.c_str());
                    if (v < 0 || v > 31) return;
                    auto ivs = entry_.ivs;
                    ivs[i] = static_cast<uint8_t>(v);
                    std::string err;
                    if (puse::core::UpdatePartyIvs(
                            core->Session().MutableBuffer(), slot_, ivs, &err))
                        CommitAndRefresh();
                }));
        };
    }

    // 6-11: EVs
    for (int i = 0; i < 6; ++i) {
        auto btn = AddField(y); y += kRowH;
        btn->eOnTap = [this, i](sl::ui::Button&) {
            Core* core = Core::Get();
            if (!core) return;
            InputManager::OpenKeyboard(new InputHandlerBuffered(
                std::to_string(entry_.evs[i]), false,
                [this, core, i](const std::string& s) {
                    int v = std::atoi(s.c_str());
                    if (v < 0 || v > 255) return;
                    auto evs = entry_.evs;
                    evs[i] = static_cast<uint8_t>(v);
                    if (core->LegitMode()) {
                        int total = 0;
                        for (auto x : evs) total += x;
                        if (total > 510) return;
                    }
                    std::string err;
                    if (puse::core::UpdatePartyEvs(
                            core->Session().MutableBuffer(), slot_, evs, &err))
                        CommitAndRefresh();
                }));
        };
    }

    RefreshFields();
}

// ---------------------------------------------------------------------------
// Moves section
// ---------------------------------------------------------------------------

void PokemonFieldsScreen::BuildMovesFields() {
    int y = kRowY0;

    // 2 rows per move: Move ID + PP UPS
    for (int m = 0; m < 4; ++m) {
        // Move ID
        {
            auto btn = AddField(y); y += kRowH;
            btn->eOnTap = [this, m](sl::ui::Button&) {
                Core* core = Core::Get();
                if (!core) return;
                InputManager::OpenKeyboard(new InputHandlerBuffered(
                    std::to_string(entry_.move_ids[m]), false,
                    [this, core, m](const std::string& s) {
                        int id = std::atoi(s.c_str());
                        if (id < 0) return;
                        auto moves = entry_.move_ids;
                        moves[m] = static_cast<uint16_t>(id);
                        std::string err;
                        if (puse::core::UpdatePartyMoves(
                                core->Session().MutableBuffer(), slot_,
                                moves, std::nullopt, std::nullopt, &err))
                            CommitAndRefresh();
                    }));
            };
        }
        // PP UPS
        {
            auto btn = AddField(y); y += kRowH;
            btn->eOnTap = [this, m](sl::ui::Button&) {
                Core* core = Core::Get();
                if (!core) return;
                InputManager::OpenKeyboard(new InputHandlerBuffered(
                    std::to_string(entry_.move_pp_ups[m]), false,
                    [this, core, m](const std::string& s) {
                        int v = std::atoi(s.c_str());
                        if (v < 0 || v > 3) return;
                        auto pp_ups = entry_.move_pp_ups;
                        pp_ups[m] = static_cast<uint8_t>(v);
                        std::string err;
                        if (puse::core::UpdatePartyMoves(
                                core->Session().MutableBuffer(), slot_,
                                entry_.move_ids, std::nullopt, pp_ups, &err))
                            CommitAndRefresh();
                    }));
            };
        }
    }

    RefreshFields();
}

// ---------------------------------------------------------------------------
// RefreshFields — update button labels from current entry_
// ---------------------------------------------------------------------------

void PokemonFieldsScreen::RefreshFields() {
    Core* core = Core::Get();
    size_t idx = 0;

    switch (section_) {
    case Section::Summary: {
        if (idx < field_btns_.size())
            field_btns_[idx++]->SetText("Nickname: " + entry_.nickname);

        if (idx < field_btns_.size()) {
            std::string sp = std::to_string(entry_.species_id);
            if (!entry_.species_name.empty()) sp += "  " + entry_.species_name;
            field_btns_[idx++]->SetText("Species: " + sp);
        }

        if (idx < field_btns_.size())
            field_btns_[idx++]->SetText("Level: " + std::to_string(entry_.level));

        if (idx < field_btns_.size())
            field_btns_[idx++]->SetText("Nature: " + entry_.nature_name + "  [tap: cycle]");

        if (idx < field_btns_.size())
            field_btns_[idx++]->SetText(std::string("Shiny: ") +
                (entry_.is_shiny ? "YES  [tap: toggle]" : "no   [tap: toggle]"));

        if (idx < field_btns_.size()) {
            std::string gstr = "Gender: " + entry_.gender;
            if (!entry_.gender_editable) gstr += "  (fixed)";
            else gstr += "  [tap: toggle]";
            field_btns_[idx++]->SetText(gstr);
        }
        break;
    }

    case Section::Battle: {
        if (idx < field_btns_.size()) {
            std::string item_str = std::to_string(entry_.item_id);
            if (core) {
                auto n = core->ItemsDb().find(entry_.item_id);
                if (n != core->ItemsDb().end()) item_str += "  " + n->second;
            }
            field_btns_[idx++]->SetText("Item: " + item_str);
        }

        if (idx < field_btns_.size()) {
            std::string abl = entry_.effective_ability_name;
            char abuf[48];
            snprintf(abuf, sizeof(abuf), "Ability[%d]: %s  [tap: cycle]",
                entry_.current_ability_index, abl.c_str());
            field_btns_[idx++]->SetText(abuf);
        }
        break;
    }

    case Section::Training: {
        // IVs
        for (int i = 0; i < 6 && idx < field_btns_.size(); ++i, ++idx) {
            char buf[32];
            snprintf(buf, sizeof(buf), "IV %s: %d", kStatNames[i], (int)entry_.ivs[i]);
            field_btns_[idx]->SetText(buf);
        }
        // EVs
        for (int i = 0; i < 6 && idx < field_btns_.size(); ++i, ++idx) {
            char buf[48];
            snprintf(buf, sizeof(buf), "EV %s: %d", kStatNames[i], (int)entry_.evs[i]);
            field_btns_[idx]->SetText(buf);
        }
        break;
    }

    case Section::Moves: {
        for (int m = 0; m < 4; ++m) {
            // Move ID
            if (idx < field_btns_.size()) {
                std::string mv_str = std::to_string(entry_.move_ids[m]);
                if (core && entry_.move_ids[m] > 0) {
                    auto n = core->MovesDb().find(entry_.move_ids[m]);
                    if (n != core->MovesDb().end()) mv_str += "  " + n->second;
                }
                char buf[64];
                snprintf(buf, sizeof(buf), "Move %d: %s", m + 1, mv_str.c_str());
                field_btns_[idx++]->SetText(buf);
            }
            // PP UPS
            if (idx < field_btns_.size()) {
                char buf[40];
                snprintf(buf, sizeof(buf), "  PP Up %d: %d  (max PP: %d)",
                    m + 1,
                    (int)entry_.move_pp_ups[m],
                    (int)entry_.move_pp_max[m]);
                field_btns_[idx++]->SetText(buf);
            }
        }
        break;
    }
    }
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

void PokemonFieldsScreen::Update(bool focused) {
    BaseScreen::Update(focused);
}

} // namespace puse::ui

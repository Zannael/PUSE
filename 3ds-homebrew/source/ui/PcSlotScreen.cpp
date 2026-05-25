#include "ui/PcSlotScreen.h"
#include "Core.h"

#include "starlight/InputManager.h"
#include "starlight/datatypes/Color.h"
#include "starlight/datatypes/VRect.h"
#include "starlight/datatypes/Vector2.h"
#include "starlight/dialog/osk/InputHandler.h"
#include "starlight/dialog/MessageBox.h"

#include <puse/core/Pc.hpp>
#include <puse/core/Party.hpp>

#include <cstdio>
#include <cstdlib>
#include <algorithm>

using sl::Color;
using sl::VRect;
using sl::Vector2;
using starlight::InputManager;
using starlight::dialog::osk::InputHandlerBuffered;
using starlight::dialog::MessageBox;

static constexpr int kRowH = 32;
static constexpr int kRowW = 316;
static constexpr int kRowX = 2;
static constexpr int kRowY0 = 2;

static const char* kStatNames[6] = {"HP","Atk","Def","SpA","SpD","Spe"};

namespace puse::ui {

PcSlotScreen::PcSlotScreen(int box, int slot, bool occupied)
    : BaseScreen(false), box_(box), slot_(slot), occupied_(occupied)
{
    std::string footer = occupied_
        ? "B: Back   DEL: Delete   X: Save"
        : "B: Back   Insert species below   X: Save";
    InitChrome(footer);

    preview_label_ = topScreen->AddNew<sl::ui::Label>(VRect(0, 35, 400, 200));
    preview_label_->SetPreset("normal.12");
    preview_label_->textConfig->justification = Vector2::half;
    preview_label_->textConfig->borderColor = Color::black;

    scroll_ = touchScreen->AddNew<sl::ui::ScrollField>(VRect(0, 0, 320, 218));

    if (occupied_) {
        LoadMon();
        BuildEditFields();
    } else {
        BuildInsertFields();
    }

    RefreshPreview();
}

std::shared_ptr<PcSlotScreen> PcSlotScreen::Make(int box, int slot, bool occupied) {
    return std::make_shared<PcSlotScreen>(box, slot, occupied);
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

void PcSlotScreen::LoadMon() {
    Core* core = Core::Get();
    if (!core || core->PcStream().empty()) return;
    auto mons = puse::core::ParsePcBox(core->PcStream(), box_, core->SpeciesDb());
    for (auto& m : mons) {
        if (m.slot == slot_) { mon_ = m; return; }
    }
}

std::string PcSlotScreen::NameOrId(const std::unordered_map<int, std::string>& db, int id) const {
    auto it = db.find(id);
    if (it != db.end()) return it->second;
    return std::to_string(id);
}

void PcSlotScreen::CommitAndRefresh() {
    Core* core = Core::Get();
    if (!core) return;
    core->CommitPcStream();
    core->SetDirty(true);
    if (occupied_) {
        LoadMon();
        RefreshFields();
    }
    RefreshPreview();
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

std::shared_ptr<sl::ui::Button> PcSlotScreen::AddField(int y) {
    auto btn = scroll_->AddNew<sl::ui::Button>(VRect(kRowX, y, kRowW, kRowH - 2));
    field_btns_.push_back(btn);
    return btn;
}

void PcSlotScreen::RefreshPreview() {
    if (!preview_label_) return;
    char buf[256];
    if (!occupied_) {
        snprintf(buf, sizeof(buf), "Box %d  Slot %d\n(empty — tap species to insert)",
            box_, slot_);
    } else {
        snprintf(buf, sizeof(buf),
            "Box %d  Slot %d\n%s / %s\nLv.%d   %s   %s%s",
            box_, slot_,
            mon_.nickname.empty() ? "???" : mon_.nickname.c_str(),
            mon_.species_name.empty() ? "???" : mon_.species_name.c_str(),
            (int)mon_.level,
            mon_.nature_name.c_str(),
            mon_.gender.c_str(),
            mon_.is_shiny ? "   [Shiny]" : "");
    }
    preview_label_->SetText(buf);
}

// ---------------------------------------------------------------------------
// Insert (empty slot)
// ---------------------------------------------------------------------------

void PcSlotScreen::BuildInsertFields() {
    int y = kRowY0;

    // Species ID → insert
    {
        auto btn = AddField(y); y += kRowH;
        btn->SetText("Species: (tap to set + insert)");
        btn->eOnTap = [this](sl::ui::Button&) {
            Core* core = Core::Get();
            if (!core) return;
            InputManager::OpenKeyboard(new InputHandlerBuffered("", false,
                [this, core](const std::string& s) {
                    int id = std::atoi(s.c_str());
                    if (id <= 0) return;
                    // Grab OT from first party mon if available
                    uint32_t otid = 0;
                    std::string ot_name = "TRAINER";
                    auto party = puse::core::ParseParty(
                        core->Session().Buffer(), core->SpeciesDb());
                    if (!party.empty()) {
                        otid    = party[0].otid;
                        ot_name = party[0].ot_name;
                    }
                    std::string err;
                    if (puse::core::InsertPcMon(
                            core->MutablePcStream(),
                            box_, slot_,
                            static_cast<uint16_t>(id),
                            50,   // default level
                            "",   // use species name as nickname
                            otid, ot_name,
                            core->SpeciesDb(), &err)) {
                        occupied_ = true;
                        LoadMon();
                        // Rebuild field list for edit mode
                        scroll_->RemoveAll();
                        field_btns_.clear();
                        BuildEditFields();
                        CommitAndRefresh();
                    }
                }));
        };
    }
}

// ---------------------------------------------------------------------------
// Edit (occupied slot) — mirrors PokemonFieldsScreen but for PcMon
// ---------------------------------------------------------------------------

void PcSlotScreen::BuildEditFields() {
    int y = kRowY0;

    // 0: Nickname
    {
        auto btn = AddField(y); y += kRowH;
        btn->eOnTap = [this](sl::ui::Button&) {
            Core* core = Core::Get();
            if (!core) return;
            InputManager::OpenKeyboard(new InputHandlerBuffered(
                mon_.nickname, false,
                [this, core](const std::string& s) {
                    std::string err;
                    if (puse::core::UpdatePcMonNickname(
                            core->MutablePcStream(), box_, slot_, s, &err))
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
                std::to_string(mon_.species_id), false,
                [this, core](const std::string& s) {
                    int id = std::atoi(s.c_str());
                    if (id <= 0) return;
                    std::string err;
                    if (puse::core::UpdatePcMonSpecies(
                            core->MutablePcStream(), box_, slot_,
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
                std::to_string(mon_.level), false,
                [this, core](const std::string& s) {
                    int lv = std::atoi(s.c_str());
                    if (lv < 1 || lv > 100) return;
                    std::string err;
                    if (puse::core::UpdatePcMonLevel(
                            core->MutablePcStream(), box_, slot_, lv, &err))
                        CommitAndRefresh();
                }));
        };
    }
    // 3: Nature (cycle)
    {
        auto btn = AddField(y); y += kRowH;
        btn->eOnTap = [this](sl::ui::Button&) {
            Core* core = Core::Get();
            if (!core) return;
            uint8_t next = static_cast<uint8_t>((mon_.nature_id + 1) % 25);
            std::string err;
            if (puse::core::UpdatePcMonNature(
                    core->MutablePcStream(), box_, slot_, next, &err))
                CommitAndRefresh();
        };
    }
    // 4: Item
    {
        auto btn = AddField(y); y += kRowH;
        btn->eOnTap = [this](sl::ui::Button&) {
            Core* core = Core::Get();
            if (!core) return;
            InputManager::OpenKeyboard(new InputHandlerBuffered(
                std::to_string(mon_.item_id), false,
                [this, core](const std::string& s) {
                    int id = std::atoi(s.c_str());
                    if (id < 0) return;
                    std::string err;
                    if (puse::core::UpdatePcMonItem(
                            core->MutablePcStream(), box_, slot_,
                            static_cast<uint16_t>(id), &err))
                        CommitAndRefresh();
                }));
        };
    }
    // 5: Shiny (toggle)
    {
        auto btn = AddField(y); y += kRowH;
        btn->eOnTap = [this](sl::ui::Button&) {
            Core* core = Core::Get();
            if (!core) return;
            std::string err;
            if (puse::core::UpdatePcMonShiny(
                    core->MutablePcStream(), box_, slot_, !mon_.is_shiny, &err))
                CommitAndRefresh();
        };
    }
    // 6: Ability (cycle 0→1→2)
    {
        auto btn = AddField(y); y += kRowH;
        btn->eOnTap = [this](sl::ui::Button&) {
            Core* core = Core::Get();
            if (!core) return;
            int next = (mon_.current_ability_index + 1) % 3;
            std::string err;
            if (puse::core::UpdatePcMonAbilitySwitch(
                    core->MutablePcStream(), box_, slot_, next, &err))
                CommitAndRefresh();
        };
    }
    // 7-12: IVs
    for (int i = 0; i < 6; ++i) {
        auto btn = AddField(y); y += kRowH;
        btn->eOnTap = [this, i](sl::ui::Button&) {
            Core* core = Core::Get();
            if (!core) return;
            InputManager::OpenKeyboard(new InputHandlerBuffered(
                std::to_string(mon_.ivs[i]), false,
                [this, core, i](const std::string& s) {
                    int v = std::atoi(s.c_str());
                    if (v < 0 || v > 31) return;
                    auto ivs = mon_.ivs;
                    ivs[i] = static_cast<uint8_t>(v);
                    std::string err;
                    if (puse::core::UpdatePcMonIvs(
                            core->MutablePcStream(), box_, slot_, ivs, &err))
                        CommitAndRefresh();
                }));
        };
    }
    // 13-18: EVs
    for (int i = 0; i < 6; ++i) {
        auto btn = AddField(y); y += kRowH;
        btn->eOnTap = [this, i](sl::ui::Button&) {
            Core* core = Core::Get();
            if (!core) return;
            InputManager::OpenKeyboard(new InputHandlerBuffered(
                std::to_string(mon_.evs[i]), false,
                [this, core, i](const std::string& s) {
                    int v = std::atoi(s.c_str());
                    if (v < 0 || v > 255) return;
                    auto evs = mon_.evs;
                    evs[i] = static_cast<uint8_t>(v);
                    if (core->LegitMode()) {
                        int total = 0;
                        for (auto x : evs) total += x;
                        if (total > 510) return;
                    }
                    std::string err;
                    if (puse::core::UpdatePcMonEvs(
                            core->MutablePcStream(), box_, slot_, evs, &err))
                        CommitAndRefresh();
                }));
        };
    }
    // 19-26: Moves (ID + PP UPS × 4)
    for (int m = 0; m < 4; ++m) {
        // Move ID
        {
            auto btn = AddField(y); y += kRowH;
            btn->eOnTap = [this, m](sl::ui::Button&) {
                Core* core = Core::Get();
                if (!core) return;
                InputManager::OpenKeyboard(new InputHandlerBuffered(
                    std::to_string(mon_.move_ids[m]), false,
                    [this, core, m](const std::string& s) {
                        int id = std::atoi(s.c_str());
                        if (id < 0) return;
                        auto moves = mon_.move_ids;
                        moves[m] = static_cast<uint16_t>(id);
                        std::string err;
                        if (puse::core::UpdatePcMonMoves(
                                core->MutablePcStream(), box_, slot_,
                                moves, nullptr, &err))
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
                    std::to_string(mon_.move_pp_ups[m]), false,
                    [this, core, m](const std::string& s) {
                        int v = std::atoi(s.c_str());
                        if (v < 0 || v > 3) return;
                        auto pp_ups = mon_.move_pp_ups;
                        pp_ups[m] = static_cast<uint8_t>(v);
                        std::string err;
                        if (puse::core::UpdatePcMonMoves(
                                core->MutablePcStream(), box_, slot_,
                                mon_.move_ids, &pp_ups, &err))
                            CommitAndRefresh();
                    }));
            };
        }
    }

    RefreshFields();
}

// ---------------------------------------------------------------------------
// RefreshFields
// ---------------------------------------------------------------------------

void PcSlotScreen::RefreshFields() {
    if (!occupied_) return;
    Core* core = Core::Get();
    size_t idx = 0;

    auto set = [&](const std::string& text) {
        if (idx < field_btns_.size()) field_btns_[idx++]->SetText(text);
    };

    set("Nickname: " + mon_.nickname);

    {
        std::string sp = std::to_string(mon_.species_id);
        if (!mon_.species_name.empty()) sp += "  " + mon_.species_name;
        set("Species: " + sp);
    }

    set("Level: " + std::to_string(mon_.level));
    set("Nature: " + mon_.nature_name + "  [tap: cycle]");

    {
        std::string it = std::to_string(mon_.item_id);
        if (core && mon_.item_id > 0) {
            auto n = core->ItemsDb().find(mon_.item_id);
            if (n != core->ItemsDb().end()) it += "  " + n->second;
        }
        set("Item: " + it);
    }

    set(std::string("Shiny: ") + (mon_.is_shiny ? "YES  [tap: toggle]" : "no   [tap: toggle]"));

    {
        char buf[64];
        snprintf(buf, sizeof(buf), "Ability[%d]: (tap: cycle)", mon_.current_ability_index);
        set(buf);
    }

    for (int i = 0; i < 6; ++i) {
        char buf[28];
        snprintf(buf, sizeof(buf), "IV %s: %d", kStatNames[i], (int)mon_.ivs[i]);
        set(buf);
    }
    for (int i = 0; i < 6; ++i) {
        char buf[28];
        snprintf(buf, sizeof(buf), "EV %s: %d", kStatNames[i], (int)mon_.evs[i]);
        set(buf);
    }
    for (int m = 0; m < 4; ++m) {
        {
            std::string mv = std::to_string(mon_.move_ids[m]);
            if (core && mon_.move_ids[m] > 0) {
                auto n = core->MovesDb().find(mon_.move_ids[m]);
                if (n != core->MovesDb().end()) mv += "  " + n->second;
            }
            char buf[64];
            snprintf(buf, sizeof(buf), "Move %d: %s", m + 1, mv.c_str());
            set(buf);
        }
        {
            char buf[36];
            snprintf(buf, sizeof(buf), "  PP Up %d: %d  (max:%d)",
                m + 1, (int)mon_.move_pp_ups[m], (int)mon_.move_pp_max[m]);
            set(buf);
        }
    }
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

void PcSlotScreen::Update(bool focused) {
    BaseScreen::Update(focused);
    if (!focused) return;

    // Delete occupied slot with Select button
    if (occupied_ && InputManager::Pressed(Keys::Select)) {
        auto box = MessageBox::New(MessageBox::YesNo,
            "Delete this PC mon?\nCannot be undone.",
            [this](int choice) {
                if (choice == 0) {  // Yes
                    Core* core = Core::Get();
                    if (!core) return;
                    // Zero out the 58-byte slot in the stream (box/slot are 1-based).
                    // Each box = kPcBoxSlotCount * kPcMonSize bytes.
                    auto& stream = core->MutablePcStream();
                    const size_t box_off = static_cast<size_t>(box_ - 1) *
                        puse::core::kPcBoxSlotCount * puse::core::kPcMonSize;
                    const size_t slot_off = box_off +
                        static_cast<size_t>(slot_ - 1) * puse::core::kPcMonSize;
                    if (slot_off + puse::core::kPcMonSize <= stream.size()) {
                        std::fill(stream.begin() + slot_off,
                                  stream.begin() + slot_off + puse::core::kPcMonSize, 0u);
                        core->CommitPcStream();
                        core->SetDirty(true);
                    }
                    Close();
                }
            });
        box->Open();
    }
}

} // namespace puse::ui

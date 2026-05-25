#include "ui/PartyListScreen.h"
#include "ui/PokemonSectionsScreen.h"
#include "ui/PcBoxScreen.h"
#include "ui/BagScreen.h"
#include "ui/MoneyScreen.h"
#include "Core.h"

#include "starlight/InputManager.h"
#include "starlight/datatypes/Color.h"
#include "starlight/datatypes/VRect.h"
#include "starlight/datatypes/Vector2.h"
#include "starlight/ui/Label.h"

#include <puse/core/Party.hpp>
#include <cstdio>

using sl::Color;
using sl::VRect;
using sl::Vector2;
using starlight::InputManager;

static constexpr int kRowH    = 36;
static constexpr int kNumSlots = 6;

namespace puse::ui {

PartyListScreen::PartyListScreen()
    : BaseScreen(true)
{
    InitChrome("A: Edit  L:PC  R:Bag  SEL:$  Y:Legit  X:Save");

    // 6-slot button list on bottom screen (fits without scroll: 6*36=216 < 218)
    scroll_ = touchScreen->AddNew<sl::ui::ScrollField>(VRect(0, 0, 320, 218));

    for (int i = 0; i < kNumSlots; ++i) {
        auto btn = scroll_->AddNew<sl::ui::Button>(VRect(2, 2 + i * kRowH, 316, kRowH - 2));
        btn->eOnTap = [this, i](sl::ui::Button&) {
            for (auto& e : party_) {
                if (e.index == i) {
                    PokemonSectionsScreen::Make(i)->Open();
                    return;
                }
            }
        };
        slot_btns_.push_back(btn);
    }

    // Top screen info label below header bar
    top_info_ = topScreen->AddNew<sl::ui::Label>(VRect(0, 35, 400, 200));
    top_info_->SetPreset("normal.16");
    top_info_->textConfig->justification = Vector2::half;
    top_info_->textConfig->borderColor = Color::black;

    LoadParty();
    RefreshSlots();
}

std::shared_ptr<PartyListScreen> PartyListScreen::Make() {
    return std::make_shared<PartyListScreen>();
}

void PartyListScreen::LoadParty() {
    Core* core = Core::Get();
    if (!core || !core->Session().IsLoaded()) {
        party_.clear();
        return;
    }
    party_ = puse::core::ParseParty(core->Session().Buffer(), core->SpeciesDb());
}

std::string PartyListScreen::SlotLabel(int idx, const puse::core::PartyEntry* e) {
    if (!e) {
        char buf[32];
        snprintf(buf, sizeof(buf), "#%d  ---  (empty)", idx + 1);
        return buf;
    }
    char buf[64];
    snprintf(buf, sizeof(buf), "#%d  %-12s  Lv.%3d  %s%s",
        idx + 1,
        e->species_name.c_str(),
        (int)e->level,
        e->nature_name.c_str(),
        e->is_shiny ? " *" : "");
    return buf;
}

void PartyListScreen::RefreshSlots() {
    for (int i = 0; i < kNumSlots; ++i) {
        const puse::core::PartyEntry* ep = nullptr;
        for (auto& e : party_) {
            if (e.index == i) { ep = &e; break; }
        }
        slot_btns_[i]->SetText(SlotLabel(i, ep));
    }

    Core* core = Core::Get();
    std::string info;
    char buf[32];
    snprintf(buf, sizeof(buf), "Party: %d / 6\n", (int)party_.size());
    info = buf;
    if (core && core->LegitMode()) info += "[Legit Mode ON]\n";
    info += "\n";
    for (auto& e : party_) {
        char row[48];
        snprintf(row, sizeof(row), "%s  Lv.%d\n", e.species_name.c_str(), (int)e.level);
        info += row;
    }
    if (top_info_) top_info_->SetText(info);
}

void PartyListScreen::Update(bool focused) {
    BaseScreen::Update(focused);
    if (!focused) { was_focused_ = false; return; }

    // Refresh on re-focus (returning from edit screens)
    if (!was_focused_) {
        LoadParty();
        RefreshSlots();
        was_focused_ = true;
    }

    if (InputManager::Pressed(Keys::L))      PcBoxScreen::Make()->Open();
    if (InputManager::Pressed(Keys::R))      BagScreen::Make()->Open();
    if (InputManager::Pressed(Keys::Select)) MoneyScreen::Make()->Open();

    // Y: toggle legit mode
    Core* core = Core::Get();
    if (core && InputManager::Pressed(Keys::Y)) {
        core->SetLegitMode(!core->LegitMode());
        RefreshSlots();
    }
}

} // namespace puse::ui

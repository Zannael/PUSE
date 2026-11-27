#include "ui/PartyListScreen.h"
#include "ui/PokemonSectionsScreen.h"
#include "ui/PcBoxScreen.h"
#include "ui/BagScreen.h"
#include "ui/MoneyScreen.h"
#include "ui/HistoryScreen.h"
#include "Core.h"

#include "starlight/InputManager.h"
#include "starlight/datatypes/Color.h"
#include "starlight/datatypes/VRect.h"
#include "starlight/datatypes/Vector2.h"
#include "starlight/dialog/MessageBox.h"
#include "starlight/ui/Label.h"

#include <puse/core/Party.hpp>
#include <puse/core/Transfer.hpp>
#include <cstdio>

using sl::Color;
using sl::VRect;
using sl::Vector2;
using starlight::InputManager;

static constexpr int kRowH    = 30;
static constexpr int kNumSlots = 6;

namespace puse::ui {

PartyListScreen::PartyListScreen()
    : PartyListScreen(0, 0, nullptr) {}

PartyListScreen::PartyListScreen(int swap_box, int swap_slot, std::function<void()> on_done)
    : BaseScreen(swap_box <= 0),
      swap_box_(swap_box),
      swap_slot_(swap_slot),
      on_swap_done_(std::move(on_done))
{
    InitChrome(swap_box_ > 0
        ? "B: Cancel   Tap party slot to Swap"
        : "A: Edit  L:PC  R:Bag  SEL:$  Y:Legit  X:Save");

    // 6-slot button list + Change History button on bottom screen (6*30 + 34 = 214 < 218)
    scroll_ = touchScreen->AddNew<sl::ui::ScrollField>(VRect(0, 0, 320, 218));

    for (int i = 0; i < kNumSlots; ++i) {
        auto btn = scroll_->AddNew<sl::ui::Button>(VRect(2, 2 + i * kRowH, 316, kRowH - 2));
        btn->eOnTap = [this, i](sl::ui::Button&) {
            for (auto& e : party_) {
                if (e.index == i) {
                    if (swap_box_ > 0) {
                        Core* core = Core::Get();
                        if (!core) return;
                        puse::core::TransferRequest req{puse::core::TransferMode::SwapPartyPc, i, swap_box_, swap_slot_};
                        puse::core::TransferResult res{};
                        std::string err;
                        if (!core->TransferPartyPc(req, &res, &err)) {
                            starlight::dialog::MessageBox::New(
                                starlight::dialog::MessageBox::Ok,
                                err.empty() ? "Swap failed" : err)->Open();
                            return;
                        }
                        std::string msg = "Swapped Party #" + std::to_string(res.party_index + 1) +
                            " with Box " + std::to_string(res.box) + "-" + std::to_string(res.slot);
                        auto cb = on_swap_done_;
                        Close();
                        if (cb) cb();
                        starlight::dialog::MessageBox::New(starlight::dialog::MessageBox::Ok, msg)->Open();
                        return;
                    }
                    PokemonSectionsScreen::Make(i)->Open();
                    return;
                }
            }
        };
        slot_btns_.push_back(btn);
    }

    if (swap_box_ <= 0) {
        history_btn_ = scroll_->AddNew<sl::ui::Button>(VRect(2, 2 + kNumSlots * kRowH, 316, 34));
        history_btn_->SetText("Change History");
        history_btn_->eOnTap = [](sl::ui::Button&) {
            HistoryScreen::Make()->Open();
        };
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

std::shared_ptr<PartyListScreen> PartyListScreen::MakeForSwap(int pc_box, int pc_slot, std::function<void()> on_done) {
    return std::make_shared<PartyListScreen>(pc_box, pc_slot, std::move(on_done));
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
    if (history_btn_ && core) {
        const auto history = core->Session().History();
        history_btn_->SetText("Change History (" + std::to_string(history.entries.size()) + ")");
    }
    std::string info;
    char buf[32];
    snprintf(buf, sizeof(buf), "Party: %d / 6\n", (int)party_.size());
    info = buf;
    puse::core::TrainerIdentity trainer{};
    if (core && puse::core::ReadTrainerIdentity(core->Session().Buffer(), &trainer))
        info += trainer.name + "  TID " + std::to_string(trainer.trainer_id & 65535) + "\n";
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

    if (swap_box_ <= 0) {
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
}

} // namespace puse::ui

#include "ui/PcBoxScreen.h"
#include "ui/PcSlotScreen.h"
#include "Core.h"

#include "starlight/InputManager.h"
#include "starlight/datatypes/Color.h"
#include "starlight/datatypes/VRect.h"
#include "starlight/datatypes/Vector2.h"
#include "starlight/dialog/MessageBox.h"

#include <puse/core/Pc.hpp>
#include <puse/core/Transfer.hpp>
#include <cstdio>

using sl::Color;
using sl::VRect;
using sl::Vector2;
using starlight::InputManager;

// Bottom screen: 3 columns × 10 rows, each slot 104×21 px, tight grid
static constexpr int kCols   = 3;
static constexpr int kRows   = 10;
static constexpr int kSlotW  = 104;
static constexpr int kSlotH  = 21;

namespace puse::ui {

PcBoxScreen::PcBoxScreen()
    : PcBoxScreen(-1, nullptr) {}

PcBoxScreen::PcBoxScreen(int transfer_party_slot, std::function<void()> on_done)
    : BaseScreen(false),
      transfer_party_slot_(transfer_party_slot),
      on_transfer_done_(std::move(on_done))
{
    InitChrome(transfer_party_slot_ >= 0
        ? "B: Cancel   L/R: Box   Tap: Move/Swap"
        : "B: Back   L/R: Prev/Next Box   A: Slot   X: Save");

    // 30 slot buttons — 3 cols × 10 rows (3*104=312, 10*21=210 < 218)
    for (int i = 0; i < kCols * kRows; ++i) {
        int col = i % kCols;
        int row = i / kCols;
        auto btn = touchScreen->AddNew<sl::ui::Button>(
            VRect(col * kSlotW + 2, row * kSlotH + 2, kSlotW - 2, kSlotH - 2));
        btn->eOnTap = [this, i](sl::ui::Button&) {
            int slot = i + 1;  // 1-based
            bool occ = false;
            for (auto& m : mons_) {
                if (m.slot == slot) { occ = true; break; }
            }
            if (transfer_party_slot_ >= 0) {
                Core* core = Core::Get();
                if (!core) return;
                puse::core::TransferRequest req{};
                req.mode = occ ? puse::core::TransferMode::SwapPartyPc : puse::core::TransferMode::PartyToPc;
                req.party_index = transfer_party_slot_;
                req.box = box_;
                req.slot = slot;
                puse::core::TransferResult res{};
                std::string err;
                if (!core->TransferPartyPc(req, &res, &err)) {
                    starlight::dialog::MessageBox::New(
                        starlight::dialog::MessageBox::Ok,
                        err.empty() ? "Transfer failed" : err)->Open();
                    return;
                }
                std::string msg = occ
                    ? ("Swapped Party #" + std::to_string(res.party_index + 1) + " with Box " + std::to_string(res.box) + "-" + std::to_string(res.slot))
                    : ("Moved Party #" + std::to_string(res.party_index + 1) + " to Box " + std::to_string(res.box) + "-" + std::to_string(res.slot));
                auto cb = on_transfer_done_;
                Close();
                if (cb) cb();
                starlight::dialog::MessageBox::New(starlight::dialog::MessageBox::Ok, msg)->Open();
                return;
            }
            PcSlotScreen::Make(box_, slot, occ)->Open();
        };
        slot_btns_.push_back(btn);
    }

    // Top screen: box name + grid overview
    box_label_ = topScreen->AddNew<sl::ui::Label>(VRect(0, 35, 400, 20));
    box_label_->SetPreset("normal.16");
    box_label_->textConfig->justification = Vector2::half;
    box_label_->textConfig->borderColor = Color::black;

    grid_label_ = topScreen->AddNew<sl::ui::Label>(VRect(0, 60, 400, 170));
    grid_label_->SetPreset("normal.12");
    grid_label_->textConfig->justification = Vector2(0.5f, 0.0f);
    grid_label_->textConfig->borderColor = Color::black;

    Core* core = Core::Get();
    if (core) box_ = core->SelectedPcBox();

    LoadBox();
    RefreshSlots();
}

std::shared_ptr<PcBoxScreen> PcBoxScreen::Make() {
    return std::make_shared<PcBoxScreen>();
}

std::shared_ptr<PcBoxScreen> PcBoxScreen::MakeForTransfer(int party_slot, std::function<void()> on_done) {
    return std::make_shared<PcBoxScreen>(party_slot, std::move(on_done));
}

void PcBoxScreen::LoadBox() {
    Core* core = Core::Get();
    if (!core || core->PcStream().empty()) {
        mons_.clear();
        return;
    }
    mons_ = puse::core::ParsePcBox(core->PcStream(), box_, core->SpeciesDb());
}

std::string PcBoxScreen::SlotLabel(int slot_idx, const puse::core::PcMon* m) {
    if (!m) {
        char buf[16];
        snprintf(buf, sizeof(buf), "[%d]", slot_idx + 1);
        return buf;
    }
    char buf[32];
    snprintf(buf, sizeof(buf), "%d:%.7s", slot_idx + 1, m->species_name.c_str());
    return buf;
}

void PcBoxScreen::RefreshSlots() {
    for (int i = 0; i < kCols * kRows; ++i) {
        const puse::core::PcMon* mp = nullptr;
        int slot_1based = i + 1;
        for (auto& m : mons_) {
            if (m.slot == slot_1based) { mp = &m; break; }
        }
        slot_btns_[i]->SetText(SlotLabel(i, mp));
    }

    // Box label on top
    char buf[48];
    snprintf(buf, sizeof(buf), "Box %d / %d   (%d mons)",
        box_, puse::core::PcStreamBoxCount(), (int)mons_.size());
    box_label_->SetText(buf);

    // Grid summary on top (6 per line = 5 lines for 30 slots)
    std::string grid;
    for (int i = 0; i < kCols * kRows; ++i) {
        int slot_1based = i + 1;
        bool occ = false;
        for (auto& m : mons_) {
            if (m.slot == slot_1based) { occ = true; break; }
        }
        grid += occ ? "#" : ".";
        if ((i + 1) % 10 == 0) grid += "\n";
        else if ((i + 1) % 5 == 0) grid += " ";
    }
    grid_label_->SetText(grid);
}

void PcBoxScreen::NavBox(int delta) {
    box_ += delta;
    if (box_ < 1) box_ = puse::core::PcStreamBoxCount();
    if (box_ > puse::core::PcStreamBoxCount()) box_ = 1;
    Core* core = Core::Get();
    if (core) core->SetSelectedPcBox(box_);
    LoadBox();
    RefreshSlots();
}

void PcBoxScreen::Update(bool focused) {
    BaseScreen::Update(focused);
    if (!focused) { was_focused_ = false; return; }

    if (!was_focused_) {
        Core* core = Core::Get();
        if (core) box_ = core->SelectedPcBox();
        LoadBox();
        RefreshSlots();
        was_focused_ = true;
    }

    if (InputManager::Pressed(Keys::L)) NavBox(-1);
    if (InputManager::Pressed(Keys::R)) NavBox(+1);
}

} // namespace puse::ui

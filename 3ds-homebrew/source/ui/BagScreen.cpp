#include "ui/BagScreen.h"
#include "Core.h"

#include "starlight/InputManager.h"
#include "starlight/datatypes/Color.h"
#include "starlight/datatypes/VRect.h"
#include "starlight/datatypes/Vector2.h"
#include "starlight/dialog/osk/InputHandler.h"

#include <puse/core/Bag.hpp>

#include <cstdio>
#include <cstdlib>
#include <algorithm>

using sl::Color;
using sl::VRect;
using sl::Vector2;
using starlight::InputManager;
using starlight::dialog::osk::InputHandlerBuffered;

static constexpr int kRowH = 32;

static const char* kPocketLabels[] = {"Items","Balls","Key","TMs","Berries"};

namespace puse::ui {

constexpr const char* BagScreen::kPocketOrder[];

BagScreen::BagScreen()
    : BaseScreen(false)
{
    InitChrome("B: Back   L/R: Pocket   A: Edit Qty   X: Save");

    // Bottom: scrollable slot list
    scroll_ = touchScreen->AddNew<sl::ui::ScrollField>(VRect(0, 0, 320, 218));

    // Top: 5 pocket tab buttons (stacked, 28px each, 5*28=140px)
    // + pocket info label below
    for (int i = 0; i < kPocketCount; ++i) {
        tab_btns_[i] = topScreen->AddNew<sl::ui::Button>(VRect(4, 35 + i * 28, 150, 26));
        tab_btns_[i]->SetText(kPocketLabels[i]);
        tab_btns_[i]->eOnTap = [this, i](sl::ui::Button&) { SwitchPocket(i); };
    }

    pocket_info_ = topScreen->AddNew<sl::ui::Label>(VRect(160, 35, 236, 170));
    pocket_info_->SetPreset("normal.12");
    pocket_info_->textConfig->justification = Vector2(0.0f, 0.0f);
    pocket_info_->textConfig->borderColor = Color::black;

    top_label_ = topScreen->AddNew<sl::ui::Label>(VRect(160, 210, 236, 24));
    top_label_->SetPreset("normal.12");
    top_label_->textConfig->justification = Vector2(0.0f, 0.0f);
    top_label_->textConfig->borderColor = Color::black;

    LoadPockets();
    LoadSlots();
    RebuildSlotButtons();
    RefreshTabs();
}

std::shared_ptr<BagScreen> BagScreen::Make() {
    return std::make_shared<BagScreen>();
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

void BagScreen::LoadPockets() {
    Core* core = Core::Get();
    if (!core) return;
    std::string err;
    core->EnsureBagReady(&err);
    pockets_ = puse::core::ResolveQuickPockets(core->Session().Buffer());
}

void BagScreen::LoadSlots() {
    Core* core = Core::Get();
    if (!core) return;
    const std::string& type = kPocketOrder[pocket_idx_];
    auto it = pockets_.find(type);
    if (it == pockets_.end() || !it->second.ready) {
        slots_.clear();
        return;
    }
    slots_ = puse::core::MapPocketFromAnchor(
        core->Session().Buffer(), it->second.anchor_offset);
}

std::string BagScreen::SlotLabel(const puse::core::BagSlot& s) const {
    Core* core = Core::Get();
    if (s.item_id == 0) return "(empty)";
    std::string name = std::to_string(s.item_id);
    if (core) {
        auto n = core->ItemsDb().find(s.item_id);
        if (n != core->ItemsDb().end()) name = n->second;
    }
    char buf[64];
    snprintf(buf, sizeof(buf), "%-24s  x%d", name.c_str(), (int)s.qty);
    return buf;
}

void BagScreen::RebuildSlotButtons() {
    scroll_->RemoveAll();
    slot_btns_.clear();

    int y = 2;
    for (size_t i = 0; i < slots_.size(); ++i) {
        if (slots_[i].item_id == 0) continue;  // skip empty slots

        auto btn = scroll_->AddNew<sl::ui::Button>(VRect(2, y, 316, kRowH - 2));
        btn->SetText(SlotLabel(slots_[i]));

        // Capture slot index; qty edit on tap (Key items and TMs are not qty-editable by convention)
        const std::string ptype = kPocketOrder[pocket_idx_];
        bool qty_editable = (ptype != "key");

        if (qty_editable) {
            btn->eOnTap = [this, i](sl::ui::Button&) {
                Core* core = Core::Get();
                if (!core || i >= slots_.size()) return;
                const auto& slot = slots_[i];
                InputManager::OpenKeyboard(new InputHandlerBuffered(
                    std::to_string(slot.qty), false,
                    [this, core, i](const std::string& s) {
                        if (i >= slots_.size()) return;
                        int qty = std::atoi(s.c_str());
                        if (qty < 0 || qty > 999) return;
                        const auto& sl = slots_[i];
                        puse::core::WriteSlot(core->Session().MutableBuffer(),
                            sl.offset, sl.item_id,
                            static_cast<uint16_t>(qty), sl.encoding_swapped);
                        puse::core::CommitBagSectorChecksums(
                            core->Session().MutableBuffer());
                        core->SetDirty(true);
                        // Reload slots and refresh
                        LoadSlots();
                        RebuildSlotButtons();
                        RefreshTabs();
                    }));
            };
        }

        slot_btns_.push_back(btn);
        y += kRowH;
    }
}

void BagScreen::RefreshTabs() {
    // Highlight active pocket tab
    for (int i = 0; i < kPocketCount; ++i) {
        std::string lbl = kPocketLabels[i];
        if (i == pocket_idx_) lbl = "> " + lbl;
        tab_btns_[i]->SetText(lbl);
    }

    // Pocket info on right side of top screen
    const std::string& type = kPocketOrder[pocket_idx_];
    auto it = pockets_.find(type);
    std::string info;
    if (it != pockets_.end()) {
        const auto& p = it->second;
        char buf[128];
        snprintf(buf, sizeof(buf),
            "Type: %s\nSlots: %d\nStatus: %s\n%s",
            type.c_str(), p.slot_count,
            p.quality.c_str(),
            p.locked ? ("Locked: " + p.locked_reason).c_str() : "");
        info = buf;
    } else {
        info = "Not found\n(unavailable)";
    }
    pocket_info_->SetText(info);

    // Count visible items
    int count = 0;
    for (auto& s : slots_) { if (s.item_id != 0) ++count; }
    char buf[32];
    snprintf(buf, sizeof(buf), "%d items", count);
    top_label_->SetText(buf);
}

void BagScreen::SwitchPocket(int idx) {
    pocket_idx_ = idx;
    LoadSlots();
    RebuildSlotButtons();
    RefreshTabs();
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

void BagScreen::Update(bool focused) {
    BaseScreen::Update(focused);
    if (!focused) { was_focused_ = false; return; }

    if (!was_focused_) {
        LoadPockets();
        LoadSlots();
        RebuildSlotButtons();
        RefreshTabs();
        was_focused_ = true;
    }

    if (InputManager::Pressed(Keys::L)) SwitchPocket((pocket_idx_ + kPocketCount - 1) % kPocketCount);
    if (InputManager::Pressed(Keys::R)) SwitchPocket((pocket_idx_ + 1) % kPocketCount);
}

} // namespace puse::ui

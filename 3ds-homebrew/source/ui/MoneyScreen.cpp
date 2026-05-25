#include "ui/MoneyScreen.h"
#include "ui/RtcScreen.h"
#include "Core.h"

#include "starlight/InputManager.h"
#include "starlight/datatypes/Color.h"
#include "starlight/datatypes/VRect.h"
#include "starlight/datatypes/Vector2.h"
#include "starlight/dialog/osk/InputHandler.h"

#include <puse/core/Money.hpp>

#include <cstdio>
#include <cstdlib>

using sl::Color;
using sl::VRect;
using sl::Vector2;
using starlight::InputManager;
using starlight::dialog::osk::InputHandlerBuffered;

namespace puse::ui {

MoneyScreen::MoneyScreen()
    : BaseScreen(false)
{
    InitChrome("B: Back   A: Edit   X: Save   RTC: Fix");

    // Top: show money + BP
    info_label_ = topScreen->AddNew<sl::ui::Label>(VRect(0, 35, 400, 100));
    info_label_->SetPreset("normal.16");
    info_label_->textConfig->justification = Vector2::half;
    info_label_->textConfig->borderColor = Color::black;

    // Bottom: two edit buttons
    money_btn_ = touchScreen->AddNew<sl::ui::Button>(VRect(20, 30, 280, 48));
    money_btn_->eOnTap = [this](sl::ui::Button&) {
        Core* core = Core::Get();
        if (!core) return;
        uint32_t cur = 0;
        core->ReadMoney(&cur);
        InputManager::OpenKeyboard(new InputHandlerBuffered(
            std::to_string(cur), false,
            [this, core](const std::string& s) {
                long val = std::atol(s.c_str());
                if (val < 0 || val > (long)puse::core::kMaxMoney) return;
                std::string err;
                if (core->WriteMoney(static_cast<uint32_t>(val), &err)) {
                    core->SetDirty(true);
                    Refresh();
                }
            }));
    };

    bp_btn_ = touchScreen->AddNew<sl::ui::Button>(VRect(20, 100, 280, 48));
    bp_btn_->eOnTap = [this](sl::ui::Button&) {
        Core* core = Core::Get();
        if (!core) return;
        uint16_t cur = 0;
        core->ReadBp(&cur);
        InputManager::OpenKeyboard(new InputHandlerBuffered(
            std::to_string(cur), false,
            [this, core](const std::string& s) {
                int val = std::atoi(s.c_str());
                if (val < 0 || val > (int)puse::core::kMaxBp) return;
                std::string err;
                if (core->WriteBp(static_cast<uint16_t>(val), &err)) {
                    core->SetDirty(true);
                    Refresh();
                }
            }));
    };

    rtc_btn_ = touchScreen->AddNew<sl::ui::Button>(VRect(20, 170, 280, 48));
    rtc_btn_->SetText("RTC Quick Fix...");
    rtc_btn_->eOnTap = [](sl::ui::Button&) {
        puse::ui::RtcScreen::Make()->Open();
    };

    Refresh();
}

std::shared_ptr<MoneyScreen> MoneyScreen::Make() {
    return std::make_shared<MoneyScreen>();
}

void MoneyScreen::Refresh() {
    Core* core = Core::Get();
    if (!core) return;

    uint32_t money = 0;
    uint16_t bp    = 0;
    core->ReadMoney(&money);
    core->ReadBp(&bp);

    char ibuf[64];
    snprintf(ibuf, sizeof(ibuf), "Money:  %u\nBP:     %u", money, (unsigned)bp);
    info_label_->SetText(ibuf);

    char mbuf[32]; snprintf(mbuf, sizeof(mbuf), "Money: %u  [tap: edit]", money);
    char bbuf[32]; snprintf(bbuf, sizeof(bbuf), "BP:    %u  [tap: edit]", (unsigned)bp);
    money_btn_->SetText(mbuf);
    bp_btn_->SetText(bbuf);
}

void MoneyScreen::Update(bool focused) {
    BaseScreen::Update(focused);
    if (!focused) { was_focused_ = false; return; }
    if (!was_focused_) { Refresh(); was_focused_ = true; }
}

} // namespace puse::ui

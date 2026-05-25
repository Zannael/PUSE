#include "ui/BaseScreen.h"
#include "ui/FillRect.h"
#include "Core.h"

#include "starlight/InputManager.h"
#include "starlight/datatypes/Color.h"
#include "starlight/datatypes/VRect.h"
#include "starlight/datatypes/Vector2.h"

using sl::Color;
using sl::VRect;
using sl::Vector2;
using sl::InputManager;

namespace {

const Color kHeaderBg = Color(0.047f, 0.067f, 0.114f);
const Color kSepLine  = Color(0.165f, 0.212f, 0.306f);
const Color kFooterBg = Color(0.047f, 0.067f, 0.114f);

} // namespace

namespace puse::ui {

BaseScreen::BaseScreen(bool is_root)
    : sl::ui::Form(true), is_root_(is_root) {}

void BaseScreen::InitChrome(const std::string& footer_hints) {
    // --- top screen chrome ---
    topScreen->AddNew<puse::ui::FillRect>(VRect(0, 0, 400, 28), kHeaderBg);

    header_label_ = topScreen->AddNew<sl::ui::Label>(VRect(0, 5, 400, 18));
    header_label_->SetPreset("normal.12");
    header_label_->textConfig->justification = Vector2::half;
    header_label_->textConfig->borderColor = Color::black;
    header_label_->SetText("PUSE 3DS");

    topScreen->AddNew<puse::ui::FillRect>(VRect(0, 28, 400, 1), kSepLine);

    // --- bottom screen chrome ---
    touchScreen->AddNew<puse::ui::FillRect>(VRect(0, 218, 320, 22), kFooterBg);

    footer_label_ = touchScreen->AddNew<sl::ui::Label>(VRect(0, 220, 320, 18));
    footer_label_->SetPreset("normal.12");
    footer_label_->textConfig->justification = Vector2::half;
    footer_label_->textConfig->borderColor = Color::black;
    footer_label_->SetText(footer_hints);
}

void BaseScreen::UpdateHeader(const std::string& save_name, bool dirty) {
    if (!header_label_) return;
    std::string text = "PUSE 3DS";
    if (!save_name.empty()) {
        text += "   " + save_name;
        if (dirty) text += " *";
    }
    Core* core = Core::Get();
    if (core && core->BatteryLow()) text += "  [LOW BATT]";
    header_label_->SetText(text);
}

void BaseScreen::Update(bool focused) {
    if (!focused) return;

    if (header_label_) {
        Core* core = Core::Get();
        if (core) {
            UpdateHeader(core->Session().FileName(), core->IsDirty());
        }
    }

    if (!is_root_ && InputManager::Pressed(Keys::B)) {
        Close();
    }
}

} // namespace puse::ui

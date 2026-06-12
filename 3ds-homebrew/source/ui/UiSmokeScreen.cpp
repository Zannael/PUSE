#include "ui/UiSmokeScreen.h"

#include "starlight/datatypes/Color.h"
#include "starlight/datatypes/VRect.h"
#include "starlight/datatypes/Vector2.h"
#include "starlight/ui/Button.h"

using sl::Color;
using sl::VRect;
using sl::Vector2;

namespace puse::ui {

namespace {

class UiSmokeChildScreen : public BaseScreen {
public:
    UiSmokeChildScreen() : BaseScreen(false) {
        InitChrome("B: Back   X: Save");

        auto top = topScreen->AddNew<sl::ui::Label>(VRect(0, 40, 400, 100));
        top->SetPreset("normal.16");
        top->textConfig->justification = Vector2::half;
        top->textConfig->borderColor = Color::black;
        top->SetText("SMOKE CHILD");

        auto bottom = touchScreen->AddNew<sl::ui::Label>(VRect(0, 70, 320, 80));
        bottom->SetPreset("normal.16");
        bottom->textConfig->justification = Vector2::half;
        bottom->textConfig->borderColor = Color::black;
        bottom->SetText("Only this form should be visible");
    }
};

} // namespace

UiSmokeScreen::UiSmokeScreen() : BaseScreen(true) {
    InitChrome("A: Open Child   X: Save");

    auto top = topScreen->AddNew<sl::ui::Label>(VRect(0, 38, 400, 26));
    top->SetPreset("normal.16");
    top->textConfig->justification = Vector2::half;
    top->textConfig->borderColor = Color::black;
    top->SetText("UI Smoke Test");

    info_ = topScreen->AddNew<sl::ui::Label>(VRect(0, 74, 400, 70));
    info_->SetPreset("normal.16");
    info_->textConfig->justification = Vector2::half;
    info_->textConfig->borderColor = Color::black;
    info_->SetText("Font + occlusion quick check");

    auto open_child = touchScreen->AddNew<sl::ui::Button>(VRect(12, 18, 296, 50));
    open_child->SetText("Open child form");
    open_child->eOnTap = [](sl::ui::Button&) {
        std::make_shared<UiSmokeChildScreen>()->Open();
    };

    auto stable = touchScreen->AddNew<sl::ui::Label>(VRect(0, 90, 320, 80));
    stable->SetPreset("normal.16");
    stable->textConfig->justification = Vector2::half;
    stable->textConfig->borderColor = Color::black;
    stable->SetText("Expected: clean text\nno overlap");
}

std::shared_ptr<UiSmokeScreen> UiSmokeScreen::Make() {
    return std::make_shared<UiSmokeScreen>();
}

} // namespace puse::ui

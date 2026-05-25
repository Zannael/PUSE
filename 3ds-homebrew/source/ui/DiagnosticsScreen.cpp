#include "ui/DiagnosticsScreen.h"

#include "starlight/datatypes/Color.h"
#include "starlight/datatypes/VRect.h"
#include "starlight/datatypes/Vector2.h"
#include "starlight/ui/Label.h"

using sl::Color;
using sl::VRect;
using sl::Vector2;

namespace puse::ui {

DiagnosticsScreen::DiagnosticsScreen(const std::string& message)
    : BaseScreen(true)
{
    InitChrome("START: Exit");

    // Error message on bottom screen — bright white, left-aligned with padding
    auto lbl = touchScreen->AddNew<sl::ui::Label>(VRect(8, 36, 304, 180));
    lbl->SetPreset("normal.12");
    lbl->textConfig->justification = Vector2::zero;
    lbl->textConfig->borderColor = Color::black;
    lbl->textConfig->textColor = Color(1.0f, 0.85f, 0.85f);  // light red tint for errors
    lbl->SetText(message);

    // Top screen: show "!" notice
    auto top_lbl = topScreen->AddNew<sl::ui::Label>(VRect(0, 90, 400, 60));
    top_lbl->SetPreset("normal.16");
    top_lbl->textConfig->justification = Vector2::half;
    top_lbl->textConfig->borderColor = Color::black;
    top_lbl->textConfig->textColor = Color(0.925f, 0.290f, 0.314f);  // accent red
    top_lbl->SetText("! Load Error !");
}

std::shared_ptr<DiagnosticsScreen> DiagnosticsScreen::Make(const std::string& message) {
    return std::make_shared<DiagnosticsScreen>(message);
}

} // namespace puse::ui

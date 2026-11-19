#include "ui/FieldInspectorScreen.h"
#include "Core.h"
#include "starlight/datatypes/Color.h"
#include "starlight/datatypes/VRect.h"
#include "starlight/datatypes/Vector2.h"
#include "starlight/ui/Label.h"
#include "starlight/ui/ScrollField.h"
#include "starlight/ui/Button.h"

namespace puse::ui {
int FieldInspectorScreen::open_count_ = 0;
bool FieldInspectorScreen::IsOpen() { return open_count_ > 0; }
FieldInspectorScreen::~FieldInspectorScreen() { --open_count_; }
std::shared_ptr<FieldInspectorScreen> FieldInspectorScreen::Make(int field) {
    return std::make_shared<FieldInspectorScreen>(field);
}
FieldInspectorScreen::FieldInspectorScreen(int field) : BaseScreen(false) {
    ++open_count_;
    InitChrome("B: Back   Read only");
    auto label = [](auto screen, const sl::VRect& rect, const std::string& text) {
        auto row = screen->template AddNew<sl::ui::Label>(rect);
        row->SetPreset("normal.12");
        row->textConfig->justification = sl::Vector2::zero;
        row->textConfig->borderColor = sl::Color::black;
        row->SetText(text);
    };
    puse::core::FieldReport report;
    std::string error;
    auto core = Core::Get();
    if (!core || !puse::core::BuildFieldReport(core->Session().Buffer(), &report, &error)) {
        label(touchScreen, sl::VRect(8, 20, 304, 180), error.empty() ? "No loaded save" : error);
        return;
    }
    label(topScreen, sl::VRect(8, 40, 384, 180), "Field Inspector\n" + report.profile_id +
        "\nKnown profile layout\nROM version unconfirmed\nUnknown flags unclassified\nSave counter: " + std::to_string(report.save_index));
    if (field >= 0 && static_cast<size_t>(field) < report.fields.size()) {
        std::string text;
        for (const auto& line: puse::core::FieldDetails(report.fields[field])) text += line + "\n";
        label(touchScreen, sl::VRect(8, 12, 304, 200), text);
    } else {
        auto scroll = touchScreen->AddNew<sl::ui::ScrollField>(sl::VRect(0, 0, 320, 218));
        for (size_t n = 0; n < report.fields.size(); ++n) {
            auto button = scroll->AddNew<sl::ui::Button>(sl::VRect(2, 2 + n * 36, 316, 34));
            button->SetText(report.fields[n].label + ": " + report.fields[n].decoded);
            button->eOnTap = [n](sl::ui::Button&) { FieldInspectorScreen::Make(static_cast<int>(n))->Open(); };
        }
    }
}
}

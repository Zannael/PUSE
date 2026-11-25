#include "ui/HistoryScreen.h"

#include "Core.h"
#include "starlight/InputManager.h"
#include "starlight/datatypes/Color.h"
#include "starlight/datatypes/VRect.h"
#include "starlight/datatypes/Vector2.h"
#include "starlight/dialog/MessageBox.h"

using sl::Color;
using sl::VRect;
using sl::Vector2;
using starlight::InputManager;
using starlight::dialog::MessageBox;

static constexpr int kRowH = 34;

namespace puse::ui {

std::shared_ptr<HistoryScreen> HistoryScreen::Make() {
    return std::make_shared<HistoryScreen>();
}

HistoryScreen::HistoryScreen()
    : BaseScreen(false) {
    InitChrome("B: Back   A: Select   X: Save");

    top_info_ = topScreen->AddNew<sl::ui::Label>(VRect(8, 34, 384, 200));
    top_info_->SetPreset("normal.12");
    top_info_->textConfig->justification = Vector2::zero;
    top_info_->textConfig->borderColor = Color::black;
    top_info_->textConfig->textColor = Color::white;

    scroll_ = touchScreen->AddNew<sl::ui::ScrollField>(VRect(0, 0, 320, 218));
    Refresh();
}

void HistoryScreen::HandleUndo() {
    Core* core = Core::Get();
    if (!core) return;
    puse::core::LedgerEntrySummary undone;
    std::string err;
    if (!core->UndoLastChange(&undone, &err)) {
        status_line_ = err.empty() ? "Nothing to undo." : err;
        Refresh();
        return;
    }
    status_line_ = "Undone: " + undone.label;
    Refresh();
}

void HistoryScreen::HandleReset() {
    Core* core = Core::Get();
    if (!core) return;
    if (!core->Session().CanReset()) {
        status_line_ = "Save already matches original.";
        Refresh();
        return;
    }
    auto box = MessageBox::New(
        MessageBox::YesNo,
        "Reset save back to original?\nAll session edits will be reverted.\nPress X to save if already written to SD.",
        [this](int choice) {
            if (choice != 0) return;
            Core* c = Core::Get();
            if (!c) return;
            c->ResetToOriginal();
            status_line_ = "Reset save to original.";
            Refresh();
        });
    box->Open();
}

void HistoryScreen::Refresh() {
    Core* core = Core::Get();
    if (!core) return;

    const auto summary = core->Session().History();

    std::string top = "Change History\n";
    top += "Recorded edits: " + std::to_string(summary.entries.size()) +
           " / " + std::to_string(summary.max_entries) + "\n";
    top += "Changed vs original: " + std::to_string(summary.total_changed_bytes) + " byte(s)\n";
    top += std::string("Unsaved to SD: ") + (core->IsDirty() ? "Yes (press X to save)" : "No") + "\n";
    if (!status_line_.empty()) {
        top += "\n" + status_line_ + "\n";
    }
    if (!summary.entries.empty()) {
        const auto& latest = summary.entries.front();
        top += "\nLatest: #" + std::to_string(latest.id) + " " + latest.label +
               " (" + std::to_string(latest.changed_bytes) + " B)";
    }
    top_info_->SetText(top);

    scroll_->RemoveAll();
    row_btns_.clear();

    int y = 4;
    {
        auto btn = scroll_->AddNew<sl::ui::Button>(VRect(4, y, 312, kRowH - 2));
        btn->SetText(summary.can_undo
            ? ("Undo: " + summary.entries.front().label)
            : "Undo Last Change (none)");
        btn->eOnTap = [this](sl::ui::Button&) { HandleUndo(); };
        row_btns_.push_back(btn);
        y += kRowH;
    }

    {
        auto btn = scroll_->AddNew<sl::ui::Button>(VRect(4, y, 312, kRowH - 2));
        btn->SetText(summary.can_reset
            ? ("Reset to Original (" + std::to_string(summary.total_changed_bytes) + " B)")
            : "Reset to Original (clean)");
        btn->eOnTap = [this](sl::ui::Button&) { HandleReset(); };
        row_btns_.push_back(btn);
        y += kRowH;
    }

    for (const auto& entry : summary.entries) {
        auto btn = scroll_->AddNew<sl::ui::Button>(VRect(4, y, 312, kRowH - 2));
        btn->SetText("#" + std::to_string(entry.id) + " " + entry.label +
                     " (" + std::to_string(entry.changed_bytes) + "B)");
        btn->eOnTap = [entry](sl::ui::Button&) {
            std::string regions_str;
            for (size_t i = 0; i < entry.regions.size(); ++i) {
                if (i > 0) regions_str += ", ";
                regions_str += entry.regions[i];
            }
            const std::string msg =
                "Edit #" + std::to_string(entry.id) + ": " + entry.label +
                "\nType: " + entry.kind +
                "\nChanged bytes: " + std::to_string(entry.changed_bytes) +
                "\nRegions: " + (regions_str.empty() ? "Unknown" : regions_str);
            MessageBox::New(MessageBox::Ok, msg)->Open();
        };
        row_btns_.push_back(btn);
        y += kRowH;
    }
}

void HistoryScreen::Update(bool focused) {
    BaseScreen::Update(focused);
    if (!focused) {
        was_focused_ = false;
        return;
    }
    if (!was_focused_) {
        Refresh();
        was_focused_ = true;
    }
}

} // namespace puse::ui

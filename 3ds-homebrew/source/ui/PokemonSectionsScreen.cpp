#include "ui/PokemonSectionsScreen.h"
#include "ui/PokemonFieldsScreen.h"
#include "ui/PcBoxScreen.h"
#include "Core.h"
#include "io/IconLoader.h"

#include "starlight/datatypes/Color.h"
#include "starlight/datatypes/VRect.h"
#include "starlight/datatypes/Vector2.h"
#include "starlight/dialog/MessageBox.h"
#include "starlight/ui/Button.h"
#include "starlight/ui/Image.h"

#include <puse/core/Party.hpp>
#include <puse/core/Transfer.hpp>
#include <cstdio>

using sl::Color;
using sl::VRect;
using sl::Vector2;

namespace puse::ui {

PokemonSectionsScreen::PokemonSectionsScreen(int slot)
    : BaseScreen(false), slot_(slot)
{
    InitChrome("B: Back   A: Select   X: Save");

    // 5 section buttons on bottom screen (5 * 42 = 210 < 218)
    static const char* kLabels[] = {"Summary", "Battle", "Training", "Moves", "Transfer to PC"};
    for (int i = 0; i < 5; ++i) {
        auto btn = touchScreen->AddNew<sl::ui::Button>(VRect(4, 4 + i * 42, 312, 38));
        btn->SetText(kLabels[i]);
        btn->eOnTap = [this, i](sl::ui::Button&) {
            if (i < 4) {
                PokemonFieldsScreen::Make(slot_, static_cast<PokemonFieldsScreen::Section>(i))->Open();
                return;
            }
            auto box = starlight::dialog::MessageBox::New(
                starlight::dialog::MessageBox::YesNo,
                "Move to first empty PC slot?\nYes: First empty PC slot\nNo: Browse PC boxes",
                [this](int choice) {
                    if (choice == 0) {
                        Core* core = Core::Get();
                        if (!core) return;
                        puse::core::TransferRequest req{puse::core::TransferMode::PartyToPc, slot_, 0, 0};
                        puse::core::TransferResult res{};
                        std::string err;
                        if (!core->TransferPartyPc(req, &res, &err)) {
                            starlight::dialog::MessageBox::New(
                                starlight::dialog::MessageBox::Ok,
                                err.empty() ? "Transfer failed" : err)->Open();
                            return;
                        }
                        std::string msg = "Moved Party #" + std::to_string(res.party_index + 1) +
                            " to Box " + std::to_string(res.box) + "-" + std::to_string(res.slot);
                        Close();
                        starlight::dialog::MessageBox::New(starlight::dialog::MessageBox::Ok, msg)->Open();
                    } else if (choice == 1) {
                        PcBoxScreen::MakeForTransfer(slot_, [this]() { Close(); })->Open();
                    }
                });
            box->Open();
        };
    }

    // Top screen: icon (right side, 80×80) + info label (left side)
    preview_label_ = topScreen->AddNew<sl::ui::Label>(VRect(0, 35, 310, 200));
    preview_label_->SetPreset("normal.16");
    preview_label_->textConfig->justification = Vector2::half;
    preview_label_->textConfig->borderColor = Color::black;

    // Icon placeholder — updated in RefreshPreview once entry is loaded
    icon_img_ = nullptr;

    LoadEntry();
    RefreshPreview();
}

std::shared_ptr<PokemonSectionsScreen> PokemonSectionsScreen::Make(int slot) {
    return std::make_shared<PokemonSectionsScreen>(slot);
}

void PokemonSectionsScreen::LoadEntry() {
    Core* core = Core::Get();
    if (!core || !core->Session().IsLoaded()) return;
    auto party = puse::core::ParseParty(core->Session().Buffer(), core->SpeciesDb());
    for (auto& e : party) {
        if (e.index == slot_) { entry_ = e; return; }
    }
}

void PokemonSectionsScreen::RefreshPreview() {
    if (!preview_label_) return;

    char buf[256];
    snprintf(buf, sizeof(buf),
        "%s  /  %s\n"
        "Lv.%d   %s   %s\n"
        "%s%s",
        entry_.nickname.empty() ? "???" : entry_.nickname.c_str(),
        entry_.species_name.empty() ? "???" : entry_.species_name.c_str(),
        (int)entry_.level,
        entry_.nature_name.c_str(),
        entry_.gender.c_str(),
        entry_.is_shiny ? "[Shiny]   " : "",
        entry_.effective_ability_name.c_str());
    preview_label_->SetText(buf);

    // Update icon — remove old, add new if path found
    if (icon_img_) {
        topScreen->Remove(icon_img_);
        icon_img_ = nullptr;
    }
    if (entry_.species_id > 0) {
        std::string ipath = puse::io::ResolveMonIconPath(entry_.species_id, entry_.is_shiny, entry_.gender, entry_.pid, true);
        if (!ipath.empty()) {
            // 80×80 icon in top-right area of top screen
            icon_img_ = topScreen->AddNew<sl::ui::Image>(VRect(312, 50, 80, 80), ipath);
        }
    }
}

void PokemonSectionsScreen::Update(bool focused) {
    BaseScreen::Update(focused);
    if (!focused) { was_focused_ = false; return; }

    if (!was_focused_) {
        LoadEntry();
        RefreshPreview();
        was_focused_ = true;
    }
}

} // namespace puse::ui

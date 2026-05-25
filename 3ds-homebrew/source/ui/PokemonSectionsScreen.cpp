#include "ui/PokemonSectionsScreen.h"
#include "ui/PokemonFieldsScreen.h"
#include "Core.h"
#include "io/IconLoader.h"

#include "starlight/datatypes/Color.h"
#include "starlight/datatypes/VRect.h"
#include "starlight/datatypes/Vector2.h"
#include "starlight/ui/Button.h"
#include "starlight/ui/Image.h"

#include <puse/core/Party.hpp>
#include <cstdio>

using sl::Color;
using sl::VRect;
using sl::Vector2;

namespace puse::ui {

PokemonSectionsScreen::PokemonSectionsScreen(int slot)
    : BaseScreen(false), slot_(slot)
{
    InitChrome("B: Back   A: Select   X: Save");

    // 4 section buttons on bottom screen
    static const char* kLabels[] = {"Summary", "Battle", "Training", "Moves"};
    for (int i = 0; i < 4; ++i) {
        auto btn = touchScreen->AddNew<sl::ui::Button>(VRect(4, 4 + i * 52, 312, 48));
        btn->SetText(kLabels[i]);
        btn->eOnTap = [this, i](sl::ui::Button&) {
            PokemonFieldsScreen::Make(slot_, static_cast<PokemonFieldsScreen::Section>(i))->Open();
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
        std::string ipath = puse::io::ResolveMonIconPath(entry_.species_id);
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

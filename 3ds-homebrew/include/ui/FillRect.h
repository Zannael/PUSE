#pragma once
#include "starlight/GFXManager.h"
#include "starlight/gfx/RenderCore.h"
#include "starlight/ui/UIElement.h"
#include "starlight/datatypes/Color.h"
#include "starlight/datatypes/VRect.h"

namespace puse::ui {

class FillRect : public sl::ui::UIElement {
    sl::Color color_;
public:
    FillRect(sl::VRect r, sl::Color c) : color_(c) { rect = r; }
    void Draw() override {
        if (!sl::GFXManager::PrepareForDrawing()) return;
        sl::gfx::RenderCore::BindColor(color_);
        sl::gfx::RenderCore::DrawQuad(rect + sl::GFXManager::GetOffset(), sl::VRect::zero);
    }
};

} // namespace puse::ui

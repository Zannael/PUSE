#pragma once

#include <memory>
#include "ui/BaseScreen.h"
#include "starlight/ui/Label.h"
#include <puse/core/Party.hpp>

namespace puse::ui {

class PokemonSectionsScreen : public BaseScreen {
public:
    static std::shared_ptr<PokemonSectionsScreen> Make(int slot);
    explicit PokemonSectionsScreen(int slot);
    void Update(bool focused) override;

private:
    int slot_;
    puse::core::PartyEntry entry_;
    std::shared_ptr<sl::ui::Label> preview_label_;
    bool was_focused_ = false;

    void LoadEntry();
    void RefreshPreview();
};

} // namespace puse::ui

#pragma once

#include <memory>
#include <vector>
#include <string>

#include "ui/BaseScreen.h"
#include "starlight/ui/ScrollField.h"
#include "starlight/ui/Button.h"
#include "starlight/ui/Label.h"
#include <puse/core/Party.hpp>

namespace puse::ui {

class PartyListScreen : public BaseScreen {
public:
    static std::shared_ptr<PartyListScreen> Make();
    PartyListScreen();
    void Update(bool focused) override;

private:
    std::vector<puse::core::PartyEntry> party_;
    std::shared_ptr<sl::ui::ScrollField> scroll_;
    std::vector<std::shared_ptr<sl::ui::Button>> slot_btns_;
    std::shared_ptr<sl::ui::Label> top_info_;
    bool was_focused_ = false;

    void LoadParty();
    void RefreshSlots();
    static std::string SlotLabel(int idx, const puse::core::PartyEntry* e);
};

} // namespace puse::ui

#pragma once

#include <memory>
#include <functional>
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
    static std::shared_ptr<PartyListScreen> MakeForSwap(int pc_box, int pc_slot, std::function<void()> on_done = nullptr);
    PartyListScreen();
    PartyListScreen(int swap_box, int swap_slot, std::function<void()> on_done);
    void Update(bool focused) override;

private:
    int swap_box_ = 0;
    int swap_slot_ = 0;
    std::function<void()> on_swap_done_;
    std::vector<puse::core::PartyEntry> party_;
    std::shared_ptr<sl::ui::ScrollField> scroll_;
    std::vector<std::shared_ptr<sl::ui::Button>> slot_btns_;
    std::shared_ptr<sl::ui::Button> history_btn_;
    std::shared_ptr<sl::ui::Label> top_info_;
    bool was_focused_ = false;

    void LoadParty();
    void RefreshSlots();
    static std::string SlotLabel(int idx, const puse::core::PartyEntry* e);
};

} // namespace puse::ui

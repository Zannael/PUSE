#pragma once

#include <memory>
#include <vector>
#include <string>
#include <unordered_map>

#include "ui/BaseScreen.h"
#include "starlight/ui/ScrollField.h"
#include "starlight/ui/Button.h"
#include "starlight/ui/Label.h"
#include <puse/core/Bag.hpp>

namespace puse::ui {

class BagScreen : public BaseScreen {
public:
    static std::shared_ptr<BagScreen> Make();
    BagScreen();
    void Update(bool focused) override;

private:
    static constexpr const char* kPocketOrder[] = {
        "main", "ball", "key", "tm", "berry"
    };
    static constexpr int kPocketCount = 5;

    int pocket_idx_ = 0;  // index into kPocketOrder

    std::unordered_map<std::string, puse::core::BagPocket> pockets_;
    std::vector<puse::core::BagSlot> slots_;

    std::shared_ptr<sl::ui::ScrollField> scroll_;
    std::vector<std::shared_ptr<sl::ui::Button>> slot_btns_;

    // Pocket tab buttons on top screen
    std::shared_ptr<sl::ui::Button> tab_btns_[kPocketCount];
    std::shared_ptr<sl::ui::Label> pocket_info_;
    std::shared_ptr<sl::ui::Label> top_label_;

    bool was_focused_ = false;

    void LoadPockets();
    void LoadSlots();
    void RebuildSlotButtons();
    void RefreshTabs();
    void SwitchPocket(int idx);
    std::string SlotLabel(const puse::core::BagSlot& s) const;
};

} // namespace puse::ui

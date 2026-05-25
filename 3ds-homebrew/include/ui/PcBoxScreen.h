#pragma once

#include <memory>
#include <vector>
#include <string>

#include "ui/BaseScreen.h"
#include "starlight/ui/ScrollField.h"
#include "starlight/ui/Button.h"
#include "starlight/ui/Label.h"
#include <puse/core/Pc.hpp>

namespace puse::ui {

class PcBoxScreen : public BaseScreen {
public:
    static std::shared_ptr<PcBoxScreen> Make();
    PcBoxScreen();
    void Update(bool focused) override;

private:
    int box_ = 1;                          // 1-based, [1..18]
    std::vector<puse::core::PcMon> mons_;  // current box contents

    // Bottom: 30 slot buttons in 3 cols × 10 rows
    std::vector<std::shared_ptr<sl::ui::Button>> slot_btns_;
    // Top: box name + navigation hint
    std::shared_ptr<sl::ui::Label> box_label_;
    std::shared_ptr<sl::ui::Label> grid_label_;

    bool was_focused_ = false;

    void LoadBox();
    void RefreshSlots();
    void NavBox(int delta);
    static std::string SlotLabel(int slot_idx, const puse::core::PcMon* m);
};

} // namespace puse::ui

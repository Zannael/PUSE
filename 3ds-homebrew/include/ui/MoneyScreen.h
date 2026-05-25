#pragma once

#include <memory>
#include "ui/BaseScreen.h"
#include "starlight/ui/Label.h"
#include "starlight/ui/Button.h"

namespace puse::ui {

class MoneyScreen : public BaseScreen {
public:
    static std::shared_ptr<MoneyScreen> Make();
    MoneyScreen();
    void Update(bool focused) override;

private:
    std::shared_ptr<sl::ui::Label> info_label_;
    std::shared_ptr<sl::ui::Button> money_btn_;
    std::shared_ptr<sl::ui::Button> bp_btn_;
    std::shared_ptr<sl::ui::Button> rtc_btn_;
    bool was_focused_ = false;

    void Refresh();
};

} // namespace puse::ui

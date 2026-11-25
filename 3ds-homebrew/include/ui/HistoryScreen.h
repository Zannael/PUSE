#pragma once

#include <memory>
#include <vector>

#include "ui/BaseScreen.h"
#include "starlight/ui/Button.h"
#include "starlight/ui/Label.h"
#include "starlight/ui/ScrollField.h"

namespace puse::ui {

class HistoryScreen : public BaseScreen {
public:
    static std::shared_ptr<HistoryScreen> Make();
    HistoryScreen();
    void Update(bool focused) override;

private:
    std::shared_ptr<sl::ui::Label> top_info_;
    std::shared_ptr<sl::ui::ScrollField> scroll_;
    std::vector<std::shared_ptr<sl::ui::Button>> row_btns_;
    bool was_focused_ = false;
    std::string status_line_;

    void Refresh();
    void HandleUndo();
    void HandleReset();
};

} // namespace puse::ui

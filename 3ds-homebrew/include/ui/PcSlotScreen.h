#pragma once

#include <memory>
#include <vector>
#include <unordered_map>
#include <string>

#include "ui/BaseScreen.h"
#include "starlight/ui/ScrollField.h"
#include "starlight/ui/Button.h"
#include "starlight/ui/Label.h"
#include <puse/core/Pc.hpp>

namespace puse::ui {

class PcSlotScreen : public BaseScreen {
public:
    // box and slot are 1-based
    static std::shared_ptr<PcSlotScreen> Make(int box, int slot, bool occupied);
    PcSlotScreen(int box, int slot, bool occupied);
    void Update(bool focused) override;

private:
    int box_;
    int slot_;
    bool occupied_;
    puse::core::PcMon mon_;

    std::shared_ptr<sl::ui::ScrollField> scroll_;
    std::vector<std::shared_ptr<sl::ui::Button>> field_btns_;
    std::shared_ptr<sl::ui::Label> preview_label_;

    void LoadMon();
    void RefreshPreview();
    void BuildInsertFields();
    void BuildEditFields();
    void RefreshFields();
    void CommitAndRefresh();

    std::shared_ptr<sl::ui::Button> AddField(int y);
    std::string NameOrId(const std::unordered_map<int, std::string>& db, int id) const;
};

} // namespace puse::ui

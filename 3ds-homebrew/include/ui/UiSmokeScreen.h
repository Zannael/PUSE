#pragma once

#include <memory>

#include "ui/BaseScreen.h"
#include "starlight/ui/Label.h"

namespace puse::ui {

class UiSmokeScreen : public BaseScreen {
public:
    static std::shared_ptr<UiSmokeScreen> Make();
    UiSmokeScreen();

private:
    std::shared_ptr<sl::ui::Label> info_;
};

} // namespace puse::ui

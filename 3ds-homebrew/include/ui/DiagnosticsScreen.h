#pragma once
#include <memory>
#include <string>

#include "ui/BaseScreen.h"

namespace puse::ui {

class DiagnosticsScreen : public BaseScreen {
public:
    explicit DiagnosticsScreen(const std::string& message);
    static std::shared_ptr<DiagnosticsScreen> Make(const std::string& message);
};

} // namespace puse::ui

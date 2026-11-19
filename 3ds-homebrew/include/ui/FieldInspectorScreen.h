#pragma once
#include "ui/BaseScreen.h"
#include <puse/core/FieldInspector.hpp>

namespace puse::ui {
class FieldInspectorScreen : public BaseScreen {
public:
    explicit FieldInspectorScreen(int field = -1);
    ~FieldInspectorScreen() override;
    static std::shared_ptr<FieldInspectorScreen> Make(int field = -1);
    static bool IsOpen();
private:
    static int open_count_;
};
}

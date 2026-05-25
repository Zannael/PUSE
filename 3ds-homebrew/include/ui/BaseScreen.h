#pragma once
#include <memory>
#include <string>

#include "starlight/ui/Form.h"
#include "starlight/ui/Label.h"

namespace puse::ui {

class BaseScreen : public sl::ui::Form {
protected:
    std::shared_ptr<sl::ui::Label> header_label_;
    std::shared_ptr<sl::ui::Label> footer_label_;
    bool is_root_;

    void InitChrome(const std::string& footer_hints);

public:
    explicit BaseScreen(bool is_root = false);

    void UpdateHeader(const std::string& save_name, bool dirty);
    void Update(bool focused) override;
};

} // namespace puse::ui

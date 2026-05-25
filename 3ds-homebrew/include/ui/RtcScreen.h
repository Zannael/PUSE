#pragma once

#include <memory>
#include <string>
#include "ui/BaseScreen.h"
#include "starlight/ui/Label.h"
#include "starlight/ui/Button.h"
#include <puse/core/Rtc.hpp>

namespace puse::ui {

class RtcScreen : public BaseScreen {
public:
    static std::shared_ptr<RtcScreen> Make();
    RtcScreen();
    void Update(bool focused) override;

private:
    puse::core::RtcManifest manifest_;
    std::string manifest_err_;

    std::shared_ptr<sl::ui::Label> status_label_;
    std::shared_ptr<sl::ui::Button> profile_btns_[3];

    void TryLoadManifest();
    void ApplyProfile(int profile_idx);
    bool WriteBytes(const std::vector<uint8_t>& bytes, std::string* error);
    void RefreshStatus();
};

} // namespace puse::ui

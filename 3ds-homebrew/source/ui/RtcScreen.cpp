#include "ui/RtcScreen.h"
#include "Core.h"

#include "starlight/datatypes/VRect.h"
#include "starlight/datatypes/Vector2.h"
#include "starlight/datatypes/Color.h"
#include "starlight/dialog/MessageBox.h"
#include <puse/io/DataLoader.hpp>

#include <cstdio>
#include <cstring>

using sl::Color;
using sl::VRect;
using sl::Vector2;
using starlight::dialog::MessageBox;

namespace puse::ui {

// Human-readable labels for each quick profile (matches kQuickProfileOrder index)
static const char* kProfileLabels[3] = {
    "Profile 1 — Trainer + Items\n(basic fix, recommended first)",
    "Profile 2 — Trainer + Items + PC\n(includes PC section)",
    "Profile 3 — Full patch\n(all affected sections)",
};

static const char* kProfileShort[3] = {
    "Legacy P1: Trainer+Items",
    "Legacy P2: +PC",
    "Legacy P3: Full patch",
};

RtcScreen::RtcScreen()
    : BaseScreen(false)
{
    InitChrome("B: Back   A: Run recovery");

    // Top screen — explanation
    auto expl = topScreen->AddNew<sl::ui::Label>(VRect(10, 35, 380, 190));
    expl->SetPreset("normal.16");
    expl->textConfig->justification = Vector2(0.0f, 0.0f);
    expl->textConfig->borderColor = Color::black;
    expl->SetText(
        "RTC Recovery\n\n"
        "Recommended: re-enable Unbound's own\n"
        "Frozen Heights Time Fixer. This validates\n"
        "the save and changes exactly one byte.\n\n"
        "Correct the console RTC first, apply the\n"
        "reset, use the NPC, save, then restart.\n\n"
        "Legacy manifest profiles remain below."
    );

    // Bottom screen — status + recommended action + legacy profiles
    status_label_ = touchScreen->AddNew<sl::ui::Label>(VRect(10, 8, 300, 20));
    status_label_->SetPreset("normal.16");
    status_label_->textConfig->justification = Vector2(0.0f, 0.5f);
    status_label_->textConfig->borderColor = Color::black;

    time_fixer_btn_ = touchScreen->AddNew<sl::ui::Button>(VRect(10, 32, 300, 46));
    time_fixer_btn_->SetText("Re-enable Time Fixer (recommended)");
    time_fixer_btn_->eOnTap = [this](sl::ui::Button&) {
        auto box = MessageBox::New(MessageBox::YesNo,
            "Is the console/emulator RTC correct?\n\n"
            "This backs up Unbound.sav and clears only\n"
            "the Time Fixer-used bit.",
            [this](int choice) {
                if (choice == 0) ApplyTimeFixerReset();
            });
        box->Open();
    };

    for (int i = 0; i < 3; i++) {
        profile_btns_[i] = touchScreen->AddNew<sl::ui::Button>(VRect(10, 82 + i * 48, 300, 44));
        profile_btns_[i]->SetText(kProfileShort[i]);
        int idx = i;
        profile_btns_[i]->eOnTap = [this, idx](sl::ui::Button&) {
            ApplyProfile(idx);
        };
    }

    TryLoadManifest();
    RefreshStatus();
}

void RtcScreen::ApplyTimeFixerReset() {
    Core* core = Core::Get();
    if (!core) return;

    puse::core::RtcTimeFixerResult result;
    std::string err;
    if (!puse::core::ReenableTimeFixer(core->Session().Buffer(), &result, &err)) {
        MessageBox::New(MessageBox::Ok, "Time Fixer reset failed:\n" + err)->Open();
        return;
    }
    if (!WriteBytes(result.bytes, &err)) {
        MessageBox::New(MessageBox::Ok, "Write failed:\n" + err)->Open();
        return;
    }

    MessageBox::New(MessageBox::Ok,
        "Time Fixer re-enabled.\n"
        "Original saved as Unbound.sav.bak\n\n"
        "Use the Frozen Heights NPC with a correct RTC,\n"
        "save in-game, then fully restart.")->Open();
}

std::shared_ptr<RtcScreen> RtcScreen::Make() {
    return std::make_shared<RtcScreen>();
}

void RtcScreen::TryLoadManifest() {
    manifest_err_.clear();
    std::string path = puse::io::ResolveAssetPath("data/rtc_manifest_unbound_v1.json");
    if (path.empty() || !puse::core::LoadRtcManifest(path, &manifest_, &manifest_err_)) {
        // SD fallback
        std::string sd_path = "sdmc:/3ds/puse/rtc_manifest_unbound_v1.json";
        std::string err2;
        if (!puse::core::LoadRtcManifest(sd_path, &manifest_, &err2)) {
            manifest_err_ = "Manifest not found in romfs or SD.\n" + manifest_err_;
        } else {
            manifest_err_.clear();
        }
    }
}

void RtcScreen::RefreshStatus() {
    if (manifest_.loaded) {
        char buf[64];
        snprintf(buf, sizeof(buf), "Manifest OK (%d sections)",
                 static_cast<int>(manifest_.changes_by_id.size()));
        status_label_->SetText(buf);
    } else {
        status_label_->SetText("Manifest FAILED — buttons disabled");
        for (int i = 0; i < 3; i++) {
            // Grey out buttons visually by overwriting label
            profile_btns_[i]->SetText(std::string(kProfileShort[i]) + " [unavailable]");
        }
    }
}

void RtcScreen::ApplyProfile(int profile_idx) {
    if (!manifest_.loaded) {
        MessageBox::New(MessageBox::Ok,
            "Manifest not loaded.\n" + manifest_err_)->Open();
        return;
    }

    Core* core = Core::Get();
    if (!core) return;

    const std::string profile_name = puse::core::kQuickProfileOrder[profile_idx];

    puse::core::RtcQuickResult result;
    std::string err;
    if (!puse::core::BuildQuickCandidates(core->Session().Buffer(), manifest_, &result, &err)) {
        MessageBox::New(MessageBox::Ok, "Build failed:\n" + err)->Open();
        return;
    }

    // Write all candidates to SD for reference
    puse::core::WriteRtcCandidates(result.candidates, puse::core::kQuickProfileOrder, 3, &err);

    // Apply chosen profile
    auto it = result.candidates.find(profile_name);
    if (it == result.candidates.end()) {
        MessageBox::New(MessageBox::Ok, "Profile not in candidates:\n" + profile_name)->Open();
        return;
    }

    if (!WriteBytes(it->second, &err)) {
        MessageBox::New(MessageBox::Ok, "Write failed:\n" + err)->Open();
        return;
    }

    MessageBox::New(MessageBox::Ok,
        std::string(kProfileLabels[profile_idx]) +
        "\n\nApplied to Unbound.sav.\n"
        "Old save backed up as .bak\n\n"
        "Restart PUSE to load fixed save."
    )->Open();
}

bool RtcScreen::WriteBytes(const std::vector<uint8_t>& bytes, std::string* error) {
    Core* core = Core::Get();
    if (!core || core->SavePath().empty()) {
        if (error) *error = "Save path not set";
        return false;
    }
    const std::string& save_path = core->SavePath();
    const std::string bak = save_path + ".bak";

    rename(save_path.c_str(), bak.c_str());

    FILE* fp = fopen(save_path.c_str(), "wb");
    if (!fp) {
        rename(bak.c_str(), save_path.c_str());
        if (error) *error = "Cannot open Unbound.sav for write";
        return false;
    }
    const size_t written = fwrite(bytes.data(), 1, bytes.size(), fp);
    fclose(fp);

    if (written != bytes.size()) {
        rename(bak.c_str(), save_path.c_str());
        if (error) *error = "Partial write — save restored from backup";
        return false;
    }
    return true;
}

void RtcScreen::Update(bool focused) {
    BaseScreen::Update(focused);
}

} // namespace puse::ui

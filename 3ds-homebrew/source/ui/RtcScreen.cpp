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
    "P1: Trainer+Items",
    "P2: Trainer+Items+PC",
    "P3: Full patch",
};

RtcScreen::RtcScreen()
    : BaseScreen(false)
{
    InitChrome("B: Back   A: Apply profile");

    // Top screen — explanation
    auto expl = topScreen->AddNew<sl::ui::Label>(VRect(10, 35, 380, 190));
    expl->SetPreset("normal.16");
    expl->textConfig->justification = Vector2(0.0f, 0.0f);
    expl->textConfig->borderColor = Color::black;
    expl->SetText(
        "RTC Quick Fix\n\n"
        "Repairs saves broken by the real-time\n"
        "clock bug in Pokemon Unbound.\n\n"
        "Select a profile to apply it directly\n"
        "to Unbound.sav and restart PUSE.\n\n"
        "Candidates also written to:\n"
        "sdmc:/3ds/puse/rtc/"
    );

    // Bottom screen — status + 3 profile buttons
    status_label_ = touchScreen->AddNew<sl::ui::Label>(VRect(10, 8, 300, 20));
    status_label_->SetPreset("normal.16");
    status_label_->textConfig->justification = Vector2(0.0f, 0.5f);
    status_label_->textConfig->borderColor = Color::black;

    for (int i = 0; i < 3; i++) {
        profile_btns_[i] = touchScreen->AddNew<sl::ui::Button>(VRect(10, 34 + i * 62, 300, 56));
        profile_btns_[i]->SetText(kProfileShort[i]);
        int idx = i;
        profile_btns_[i]->eOnTap = [this, idx](sl::ui::Button&) {
            ApplyProfile(idx);
        };
    }

    TryLoadManifest();
    RefreshStatus();
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
    const char* save_path = Core::kSavePath;
    std::string bak = std::string(save_path) + ".bak";

    rename(save_path, bak.c_str());

    FILE* fp = fopen(save_path, "wb");
    if (!fp) {
        rename(bak.c_str(), save_path);
        if (error) *error = "Cannot open Unbound.sav for write";
        return false;
    }
    const size_t written = fwrite(bytes.data(), 1, bytes.size(), fp);
    fclose(fp);

    if (written != bytes.size()) {
        rename(bak.c_str(), save_path);
        if (error) *error = "Partial write — save restored from backup";
        return false;
    }
    return true;
}

void RtcScreen::Update(bool focused) {
    BaseScreen::Update(focused);
}

} // namespace puse::ui

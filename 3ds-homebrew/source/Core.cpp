#include "Core.h"

#include <sys/stat.h>
#include <cstdio>
#include <cstring>
#include <3ds.h>

#include "starlight/Application.h"
#include "starlight/InputManager.h"

#include <puse/core/Party.hpp>
#include <puse/core/Pc.hpp>
#include <puse/core/Bag.hpp>
#include <puse/core/Money.hpp>
#include <puse/core/SaveSections.hpp>
#include <puse/io/DataLoader.hpp>

#include "ui/DiagnosticsScreen.h"
#include "ui/PartyListScreen.h"

using starlight::Application;
using starlight::InputManager;

void Core::Init() {
    clearColor = sl::Color(0.063f, 0.086f, 0.137f);

    mkdir("sdmc:/3ds", 0777);
    mkdir("sdmc:/3ds/puse", 0777);

    std::string err;
    if (!session_.LoadFromFile(kSavePath, &err)) {
        puse::ui::DiagnosticsScreen::Make(
            "Save not found.\n\n"
            "Place your Unbound.sav at:\nsdmc:/3ds/puse/Unbound.sav\n\n" + err
        )->Open();
        return;
    }

    if (!puse::core::EnsurePartyStaticDataLoaded(&err)) {
        puse::ui::DiagnosticsScreen::Make(
            "Static data load failed.\n\n" + err
        )->Open();
        return;
    }

    // Load name databases for UI display
    {
        std::string sp = puse::io::ResolveAssetPath("data/pokemon.txt");
        std::string it = puse::io::ResolveAssetPath("data/items.txt");
        std::string mv = puse::io::ResolveAssetPath("data/moves.txt");
        if (!sp.empty()) species_db_ = puse::io::LoadIdNameFile(sp);
        if (!it.empty()) items_db_   = puse::io::LoadIdNameFile(it);
        if (!mv.empty()) moves_db_   = puse::io::LoadIdNameFile(mv);
    }

    LoadConfig();

    // Pre-build PC stream so box screen loads instantly
    std::string pc_err;
    RebuildPcStream(&pc_err);

    // Suspend hook: flush save on APTHOOK_ONSUSPEND (lid close / home button)
    aptHook(&apt_hook_cookie_, [](APT_HookType type, void* param) {
        Core* self = static_cast<Core*>(param);
        if (type == APTHOOK_ONSUSPEND && self->IsDirty()) {
            self->SaveWithBackup(nullptr);
        }
    }, this);
    apt_hooked_ = true;

    mkdir(kRtcDir, 0777);

    puse::ui::PartyListScreen::Make()->Open();
}

void Core::End() {
    if (apt_hooked_) aptUnhook(&apt_hook_cookie_);
}

void Core::Update() {
    if (InputManager::Pressed(Keys::Start)) {
        Application::Quit();
    }

    if (InputManager::Pressed(Keys::X)) {
        if (session_.IsLoaded()) {
            std::string err;
            SaveWithBackup(&err);
        }
    }

    // Poll battery every ~300 frames (~5 s at 60fps)
    if (++battery_poll_frames_ >= 300) {
        battery_poll_frames_ = 0;
        u8 level = 5;
        if (R_SUCCEEDED(ptmuInit())) {
            PTMU_GetBatteryLevel(&level);
            ptmuExit();
        }
        battery_low_ = (level <= 1);
    }
}

bool Core::SaveWithBackup(std::string* error) {
    if (!session_.IsLoaded()) return false;

    // Recompute checksums before write
    puse::core::RefreshPartyMonChecksums(session_.MutableBuffer());
    puse::core::CommitPartySectionChecksums(session_.MutableBuffer());

    // Backup existing save
    std::string bak = std::string(kSavePath) + ".bak";
    rename(kSavePath, bak.c_str());

    std::string err;
    if (!session_.ExportToFile(kSavePath, &err)) {
        // Restore backup on failure
        rename(bak.c_str(), kSavePath);
        if (error) *error = err;
        return false;
    }
    dirty_ = false;
    return true;
}

void Core::SetLegitMode(bool v) {
    legit_mode_ = v;
    SaveConfig();
}

void Core::LoadConfig() {
    FILE* f = fopen(kConfigPath, "r");
    if (f) {
        legit_mode_ = true;
        fclose(f);
    } else {
        legit_mode_ = false;
    }
}

bool Core::RebuildPcStream(std::string* error) {
    pc_stream_ = puse::core::BuildPcStream(session_.Buffer(), error);
    return !pc_stream_.empty();
}

bool Core::CommitPcStream(std::string* error) {
    return puse::core::CommitPcStream(session_.MutableBuffer(), pc_stream_, error);
}

bool Core::EnsureBagReady(std::string* error) {
    if (bag_ready_) return true;
    bag_ready_ = puse::core::EnsureBagDataLoaded(error);
    return bag_ready_;
}

bool Core::ReadMoney(uint32_t* out, std::string* error) const {
    return puse::core::ReadMoney(session_.Buffer(), out, error);
}
bool Core::WriteMoney(uint32_t val, std::string* error) {
    return puse::core::WriteMoney(session_.MutableBuffer(), val, error);
}
bool Core::ReadBp(uint16_t* out, std::string* error) const {
    return puse::core::ReadBp(session_.Buffer(), out, error);
}
bool Core::WriteBp(uint16_t val, std::string* error) {
    return puse::core::WriteBp(session_.MutableBuffer(), val, error);
}

void Core::SaveConfig() {
    if (legit_mode_) {
        FILE* f = fopen(kConfigPath, "w");
        if (f) fclose(f);
    } else {
        remove(kConfigPath);
    }
}

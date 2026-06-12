#include "Core.h"

#include <sys/stat.h>
#include <cstdio>
#include <cstring>
#include <cctype>
#include <dirent.h>
#include <algorithm>
#include <vector>
#include <3ds.h>

#include "starlight/Application.h"
#include "starlight/InputManager.h"
#include "starlight/ThemeManager.h"

#include <puse/core/Party.hpp>
#include <puse/core/Pc.hpp>
#include <puse/core/Bag.hpp>
#include <puse/core/Money.hpp>
#include <puse/core/SaveSections.hpp>
#include <puse/io/DataLoader.hpp>

#include "starlight/dialog/MessageBox.h"
#include "ui/DiagnosticsScreen.h"
#include "ui/PartyListScreen.h"
#include "ui/UiSmokeScreen.h"

using starlight::Application;
using starlight::InputManager;
using starlight::dialog::MessageBox;

namespace {

bool FileExists(const std::string& p) {
    FILE* f = std::fopen(p.c_str(), "rb");
    if (!f) return false;
    std::fclose(f);
    return true;
}

std::string ToLower(std::string s) {
    for (auto& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return s;
}

bool EndsWith(const std::string& s, const std::string& suf) {
    return s.size() >= suf.size() && std::equal(suf.rbegin(), suf.rend(), s.rbegin());
}

bool IsDir(const std::string& p) {
    struct stat st;
    if (stat(p.c_str(), &st) != 0) return false;
    return S_ISDIR(st.st_mode);
}

// depth-bounded walk: collect any .sav matching unbound (case-insensitive).
// preferred=true match means filename basename is exactly "unbound.sav".
void WalkSavs(const std::string& root, int depth,
              std::vector<std::string>* exact,
              std::vector<std::string>* substr_match) {
    if (depth < 0) return;
    DIR* d = opendir(root.c_str());
    if (!d) return;
    struct dirent* ent;
    while ((ent = readdir(d)) != nullptr) {
        const std::string name = ent->d_name;
        if (name == "." || name == "..") continue;
        const std::string full = root + "/" + name;
        if (IsDir(full)) {
            WalkSavs(full, depth - 1, exact, substr_match);
        } else {
            const std::string lname = ToLower(name);
            if (!EndsWith(lname, ".sav")) continue;
            if (lname == "unbound.sav") {
                exact->push_back(full);
            } else if (lname.find("unbound") != std::string::npos) {
                substr_match->push_back(full);
            }
        }
    }
    closedir(d);
}

std::string FindUnboundSave() {
    // 1) quick probe of likely paths
    static const char* kProbe[] = {
        "sdmc:/3ds/puse/Unbound.sav",
        "sdmc:/3ds/open_agb_firm/saves/Unbound.sav",
        "sdmc:/3ds/openagbfw/saves/Unbound.sav",
        "sdmc:/3ds/Unbound.sav",
        "sdmc:/saves/Unbound.sav",
        "sdmc:/retroarch/saves/Unbound.sav",
        "sdmc:/Unbound.sav",
    };
    for (const char* p : kProbe) {
        if (FileExists(p)) return p;
    }

    // 2) bounded recursive walk of likely roots
    std::vector<std::string> roots = {
        "sdmc:/3ds",
        "sdmc:/roms",
        "sdmc:/saves",
    };
    std::vector<std::string> exact, substr_match;
    for (const auto& root : roots) {
        if (!IsDir(root)) continue;
        WalkSavs(root, 3, &exact, &substr_match);
    }
    if (!exact.empty()) return exact.front();
    if (!substr_match.empty()) return substr_match.front();
    return "";
}

bool PreloadUiAssets() {
    try {
        starlight::ThemeManager::GetFont("normal.16").GetShared();
        starlight::ThemeManager::GetFont("normal.12").GetShared();
        starlight::ThemeManager::GetAsset("controls/button.idle").GetShared();
        starlight::ThemeManager::GetAsset("controls/button.press").GetShared();
        return true;
    } catch (...) {
        return false;
    }
}

} // namespace

void Core::Init() {
    clearColor = sl::Color(0.063f, 0.086f, 0.137f);

    PreloadUiAssets();

    mkdir("sdmc:/3ds", 0777);
    mkdir("sdmc:/3ds/puse", 0777);

    save_path_ = FindUnboundSave();
    if (save_path_.empty()) {
        puse::ui::DiagnosticsScreen::Make(
            "Unbound.sav not found on SD.\n\n"
            "Place it at one of:\n"
            "  sdmc:/3ds/puse/Unbound.sav\n"
            "  sdmc:/3ds/open_agb_firm/saves/\n"
            "  sdmc:/roms/...\n\n"
            "Or any folder under /3ds, /roms, /saves."
        )->Open();
        return;
    }

    std::string err;
    if (!session_.LoadFromFile(save_path_, &err)) {
        puse::ui::DiagnosticsScreen::Make(
            "Save found but load failed.\n\n" + save_path_ + "\n\n" + err
        )->Open();
        return;
    }

    if (!puse::core::EnsurePartyStaticDataLoaded(&err)) {
        puse::ui::DiagnosticsScreen::Make(
            "Static data load failed.\n\n" + err
        )->Open();
        return;
    }

    {
        std::string sp = puse::io::ResolveAssetPath("data/pokemon.txt");
        std::string it = puse::io::ResolveAssetPath("data/items.txt");
        std::string mv = puse::io::ResolveAssetPath("data/moves.txt");
        if (!sp.empty()) species_db_ = puse::io::LoadIdNameFile(sp);
        if (!it.empty()) items_db_   = puse::io::LoadIdNameFile(it);
        if (!mv.empty()) moves_db_   = puse::io::LoadIdNameFile(mv);
    }

    LoadConfig();

    std::string pc_err;
    RebuildPcStream(&pc_err);

    aptHook(&apt_hook_cookie_, [](APT_HookType type, void* param) {
        Core* self = static_cast<Core*>(param);
        if (type == APTHOOK_ONSUSPEND && self->IsDirty()) {
            self->SaveWithBackup(nullptr);
        }
    }, this);
    apt_hooked_ = true;

    mkdir(kRtcDir, 0777);

    if (FileExists("sdmc:/3ds/puse/ui_smoke")) {
        puse::ui::UiSmokeScreen::Make()->Open();
        return;
    }

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
            bool ok = SaveWithBackup(&err);
            std::string msg = ok ? "Saved!" : ("Save failed!\n" + err);
            MessageBox::New(MessageBox::Ok, msg)->Open();
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
    if (save_path_.empty()) {
        if (error) *error = "save path not set";
        return false;
    }

    puse::core::RefreshPartyMonChecksums(session_.MutableBuffer());
    puse::core::CommitPartySectionChecksums(session_.MutableBuffer());

    const std::string bak = save_path_ + ".bak";
    rename(save_path_.c_str(), bak.c_str());

    std::string err;
    if (!session_.ExportToFile(save_path_, &err)) {
        rename(bak.c_str(), save_path_.c_str());
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

#include "Core.h"

#include <sys/stat.h>
#include <cstdio>
#include <3ds.h>

#include "starlight/Application.h"
#include "starlight/InputManager.h"

#include <puse/core/Party.hpp>
#include <puse/core/Pc.hpp>
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

    puse::ui::PartyListScreen::Make()->Open();
}

void Core::End() {}

void Core::Update() {
    if (InputManager::Pressed(Keys::Start)) {
        Application::Quit();
    }

    if (InputManager::Pressed(Keys::X)) {
        if (session_.IsLoaded()) {
            puse::core::RefreshPartyMonChecksums(session_.MutableBuffer());
            puse::core::CommitPartySectionChecksums(session_.MutableBuffer());
            std::string err;
            if (session_.ExportToFile(kSavePath, &err)) {
                dirty_ = false;
            }
        }
    }
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

void Core::SaveConfig() {
    if (legit_mode_) {
        FILE* f = fopen(kConfigPath, "w");
        if (f) fclose(f);
    } else {
        remove(kConfigPath);
    }
}

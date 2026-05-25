#pragma once

#include "starlight/Application.h"
#include <puse/core/SaveSession.hpp>
#include <puse/io/DataLoader.hpp>
#include <unordered_map>
#include <string>
#include <vector>
#include <cstdint>

class Core : public starlight::Application {
public:
    static constexpr const char* kSavePath    = "sdmc:/3ds/puse/Unbound.sav";
    static constexpr const char* kConfigPath  = "sdmc:/3ds/puse/legit_mode";

    static Core* Get() {
        return static_cast<Core*>(starlight::Application::Current());
    }

    Core() : Application("puse") {}
    ~Core() override = default;

    void Init() override;
    void End() override;
    void Update() override;

    puse::core::SaveSession& Session() { return session_; }
    bool IsDirty() const { return dirty_; }
    void SetDirty(bool d) { dirty_ = d; }

    const std::unordered_map<int, std::string>& SpeciesDb() const { return species_db_; }
    const std::unordered_map<int, std::string>& ItemsDb()   const { return items_db_; }
    const std::unordered_map<int, std::string>& MovesDb()   const { return moves_db_; }

    bool LegitMode() const { return legit_mode_; }
    void SetLegitMode(bool v);

    // PC stream — built lazily on first access; call RebuildPcStream() after any save load.
    const std::vector<uint8_t>& PcStream() const { return pc_stream_; }
    std::vector<uint8_t>& MutablePcStream() { return pc_stream_; }
    bool RebuildPcStream(std::string* error = nullptr);
    bool CommitPcStream(std::string* error = nullptr);

    int SelectedPcBox() const { return selected_pc_box_; }
    void SetSelectedPcBox(int b) { selected_pc_box_ = b; }

private:
    puse::core::SaveSession session_;
    bool dirty_      = false;
    bool legit_mode_ = false;
    std::unordered_map<int, std::string> species_db_;
    std::unordered_map<int, std::string> items_db_;
    std::unordered_map<int, std::string> moves_db_;

    std::vector<uint8_t> pc_stream_;
    int selected_pc_box_ = 1;

    void LoadConfig();
    void SaveConfig();
};

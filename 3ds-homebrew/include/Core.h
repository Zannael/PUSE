#pragma once

#include "starlight/Application.h"
#include <puse/core/SaveSession.hpp>
#include <puse/io/DataLoader.hpp>
#include <3ds.h>
#include <unordered_map>
#include <string>
#include <vector>
#include <cstdint>

class Core : public starlight::Application {
public:
    static constexpr const char* kDefaultSavePath = "sdmc:/3ds/puse/Unbound.sav";
    static constexpr const char* kConfigPath      = "sdmc:/3ds/puse/legit_mode";

    const std::string& SavePath() const { return save_path_; }

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

    // Bag pocket cache — resolved once after save load.
    bool BagReady() const { return bag_ready_; }
    bool EnsureBagReady(std::string* error = nullptr);

    // Money / BP helpers (thin wrappers; no cache needed).
    bool ReadMoney(uint32_t* out, std::string* error = nullptr) const;
    bool WriteMoney(uint32_t val, std::string* error = nullptr);
    bool ReadBp(uint16_t* out, std::string* error = nullptr) const;
    bool WriteBp(uint16_t val, std::string* error = nullptr);

    // Save with backup; returns true on success.
    bool SaveWithBackup(std::string* error = nullptr);

    // Battery low flag (set in Update, polled by UI).
    bool BatteryLow() const { return battery_low_; }

    static constexpr const char* kRtcDir = "sdmc:/3ds/puse/rtc";

private:
    puse::core::SaveSession session_;
    bool dirty_      = false;
    bool legit_mode_ = false;
    std::unordered_map<int, std::string> species_db_;
    std::unordered_map<int, std::string> items_db_;
    std::unordered_map<int, std::string> moves_db_;

    std::vector<uint8_t> pc_stream_;
    int selected_pc_box_ = 1;
    bool bag_ready_ = false;
    bool battery_low_ = false;
    int battery_poll_frames_ = 0;
    aptHookCookie apt_hook_cookie_{};
    bool apt_hooked_ = false;
    std::string save_path_;

    void LoadConfig();
    void SaveConfig();
};

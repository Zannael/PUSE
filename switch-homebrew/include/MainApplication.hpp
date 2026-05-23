#pragma once

#include <pu/Plutonium>

#include <functional>
#include <string>
#include <tuple>
#include <unordered_set>
#include <unordered_map>
#include <vector>

#include <puse/core/Bag.hpp>
#include <puse/core/Party.hpp>
#include <puse/core/Pc.hpp>
#include <puse/core/Rtc.hpp>
#include <puse/core/SaveSession.hpp>

namespace puse::ui {

struct UiTheme {
    pu::ui::Color page_bg;
    pu::ui::Color header_bg;
    pu::ui::Color footer_bg;
    pu::ui::Color panel_bg;
    pu::ui::Color text_primary;
    pu::ui::Color text_secondary;
    pu::ui::Color accent;
    pu::ui::Color menu_item;
    pu::ui::Color menu_focus;
};

class BasePageLayout : public pu::ui::Layout {
  protected:
    UiTheme theme_;
    pu::ui::elm::Rectangle::Ref header_bg_;
    pu::ui::elm::Rectangle::Ref footer_bg_;
    pu::ui::elm::Image::Ref header_icon_;
    pu::ui::elm::TextBlock::Ref title_text_;
    pu::ui::elm::TextBlock::Ref subtitle_text_;
    pu::ui::elm::TextBlock::Ref hints_text_;

  public:
    BasePageLayout(const UiTheme &theme, const std::string &title, pu::sdl2::TextureHandle::Ref icon);
    void SetTitle(const std::string &title);
    void SetSubtitle(const std::string &subtitle);
    void SetHints(const std::string &hints);
};

class HomeLayout : public BasePageLayout {
  private:
    pu::ui::elm::Menu::Ref menu_;

  public:
    HomeLayout(const UiTheme &theme, pu::sdl2::TextureHandle::Ref header_icon);
    pu::ui::elm::Menu::Ref GetMenu();
    PU_SMART_CTOR(HomeLayout)
};

class PartyListLayout : public BasePageLayout {
  private:
    pu::ui::elm::Menu::Ref menu_;

  public:
    PartyListLayout(const UiTheme &theme, pu::sdl2::TextureHandle::Ref header_icon);
    pu::ui::elm::Menu::Ref GetMenu();
    PU_SMART_CTOR(PartyListLayout)
};

class PokemonSectionsLayout : public BasePageLayout {
  private:
    pu::ui::elm::Image::Ref mon_icon_;
    pu::ui::elm::Menu::Ref sections_menu_;

  public:
    PokemonSectionsLayout(const UiTheme &theme, pu::sdl2::TextureHandle::Ref header_icon);
    pu::ui::elm::Menu::Ref GetMenu();
    void SetPokemonHeader(const core::PartyEntry &entry, pu::sdl2::TextureHandle::Ref icon, bool dirty = false);
    void SetMonIcon(pu::sdl2::TextureHandle::Ref icon);
    PU_SMART_CTOR(PokemonSectionsLayout)
};

class PokemonFieldsLayout : public BasePageLayout {
  private:
    pu::ui::elm::Menu::Ref fields_menu_;

  public:
    PokemonFieldsLayout(const UiTheme &theme, pu::sdl2::TextureHandle::Ref header_icon);
    pu::ui::elm::Menu::Ref GetMenu();
    void SetSectionHeader(const std::string &pokemon_name, const std::string &section_name);
    PU_SMART_CTOR(PokemonFieldsLayout)
};

class DiagnosticsLayout : public BasePageLayout {
  private:
    std::vector<pu::ui::elm::TextBlock::Ref> lines_;

  public:
    DiagnosticsLayout(const UiTheme &theme, pu::sdl2::TextureHandle::Ref header_icon);
    void SetLines(const std::vector<std::string> &lines);
    PU_SMART_CTOR(DiagnosticsLayout)
};

class PokemonMoveListLayout : public BasePageLayout {
  private:
    pu::ui::elm::Menu::Ref move_list_menu_;

  public:
    PokemonMoveListLayout(const UiTheme &theme, pu::sdl2::TextureHandle::Ref header_icon);
    pu::ui::elm::Menu::Ref GetMenu();
    PU_SMART_CTOR(PokemonMoveListLayout)
};

class PokemonMoveEditLayout : public BasePageLayout {
  private:
    pu::ui::elm::Menu::Ref move_edit_menu_;

  public:
    PokemonMoveEditLayout(const UiTheme &theme, pu::sdl2::TextureHandle::Ref header_icon);
    pu::ui::elm::Menu::Ref GetMenu();
    void SetMoveSlotHeader(const std::string &pokemon_name, int slot);
    PU_SMART_CTOR(PokemonMoveEditLayout)
};

class MoneyEditLayout : public BasePageLayout {
  private:
    pu::ui::elm::Menu::Ref menu_;

  public:
    MoneyEditLayout(const UiTheme &theme, pu::sdl2::TextureHandle::Ref header_icon);
    pu::ui::elm::Menu::Ref GetMenu();
    PU_SMART_CTOR(MoneyEditLayout)
};

class PcBoxListLayout : public BasePageLayout {
  private:
    pu::ui::elm::Menu::Ref menu_;

  public:
    PcBoxListLayout(const UiTheme &theme, pu::sdl2::TextureHandle::Ref header_icon);
    pu::ui::elm::Menu::Ref GetMenu();
    PU_SMART_CTOR(PcBoxListLayout)
};

class PcBoxLayout : public BasePageLayout {
  private:
    pu::ui::elm::Menu::Ref menu_;

  public:
    PcBoxLayout(const UiTheme &theme, pu::sdl2::TextureHandle::Ref header_icon);
    pu::ui::elm::Menu::Ref GetMenu();
    PU_SMART_CTOR(PcBoxLayout)
};

class BagLayout : public BasePageLayout {
  private:
    pu::ui::elm::Menu::Ref menu_;

  public:
    BagLayout(const UiTheme &theme, pu::sdl2::TextureHandle::Ref header_icon);
    pu::ui::elm::Menu::Ref GetMenu();
    PU_SMART_CTOR(BagLayout)
};

class BagPocketLayout : public BasePageLayout {
  private:
    pu::ui::elm::Menu::Ref menu_;

  public:
    BagPocketLayout(const UiTheme &theme, pu::sdl2::TextureHandle::Ref header_icon);
    pu::ui::elm::Menu::Ref GetMenu();
    PU_SMART_CTOR(BagPocketLayout)
};

class RtcLayout : public BasePageLayout {
  private:
    pu::ui::elm::Menu::Ref menu_;

  public:
    RtcLayout(const UiTheme &theme, pu::sdl2::TextureHandle::Ref header_icon);
    pu::ui::elm::Menu::Ref GetMenu();
    PU_SMART_CTOR(RtcLayout)
};

class FileBrowserLayout : public BasePageLayout {
  public:
    using FileSelectedCallback = std::function<void(const std::string &)>;
    FileBrowserLayout(const UiTheme &theme, pu::sdl2::TextureHandle::Ref header_icon,
                      std::string start_path, FileSelectedCallback on_selected);
    PU_SMART_CTOR(FileBrowserLayout)
    pu::ui::elm::Menu::Ref GetMenu();
    void OpenAt(const std::string &path);

  private:
    std::string current_path_;
    std::string start_path_;
    FileSelectedCallback on_selected_;
    pu::ui::elm::Menu::Ref file_menu_;
    void PopulateMenu();
    static std::string ParentOf(const std::string &path);
};

enum class EditContext { Party, Pc };

class MainApplication : public pu::ui::Application {
  private:
    UiTheme theme_;
    std::vector<pu::ui::Layout::Ref> layout_stack_;

    HomeLayout::Ref home_layout_;
    PartyListLayout::Ref party_list_layout_;
    PokemonSectionsLayout::Ref pokemon_sections_layout_;
    PokemonFieldsLayout::Ref pokemon_fields_layout_;
    PokemonMoveListLayout::Ref pokemon_move_list_layout_;
    PokemonMoveEditLayout::Ref pokemon_move_edit_layout_;
    DiagnosticsLayout::Ref diagnostics_layout_;
    MoneyEditLayout::Ref money_edit_layout_;
    PcBoxListLayout::Ref pc_box_list_layout_;
    PcBoxLayout::Ref pc_box_layout_;
    BagLayout::Ref bag_layout_;
    BagPocketLayout::Ref bag_pocket_layout_;
    RtcLayout::Ref rtc_layout_;
    FileBrowserLayout::Ref file_browser_layout_;

    std::vector<core::PartyEntry> party_;
    std::unordered_map<int, std::string> species_db_;
    std::unordered_map<int, std::string> items_db_;
    std::unordered_map<int, std::string> moves_db_;
    std::unordered_map<int, std::string> species_id_tokens_;

    pu::sdl2::TextureHandle::Ref app_icon_;
    int selected_party_index_;
    int selected_move_slot_;
    pu::ui::elm::TextBlock::Ref toast_text_;
    pu::ui::extras::Toast::Ref save_toast_;
    std::unordered_map<uint16_t, pu::sdl2::TextureHandle::Ref> pokemon_icon_cache_;
    std::unordered_map<uint16_t, pu::sdl2::TextureHandle::Ref> item_icon_cache_;
    core::SaveSession save_session_;
    bool dirty_;

    bool item_index_ready_;
    std::unordered_map<std::string, std::string> item_norm_to_path_;
    std::vector<std::tuple<std::unordered_set<std::string>, std::string, std::string>> item_token_index_;

    // PC state
    std::vector<uint8_t> pc_stream_;
    bool pc_stream_loaded_;
    int selected_pc_box_;   // 1-based
    int selected_pc_slot_;  // 1-based
    core::PcMon selected_pc_mon_;

    // Bag state
    std::unordered_map<std::string, core::BagPocket> bag_pockets_;
    std::string selected_bag_pocket_type_;

    // RTC state
    core::RtcManifest rtc_manifest_;

    // Edit context for shared layouts (sections / fields / moves)
    EditContext edit_context_;

    void ConfigureTheme();
    bool LoadSpeciesIdTokens();
    void BuildItemIconIndex();
    bool LoadStaticData(std::string *error);
    bool LoadSaveFromPath(const std::string &path, std::string *error);
    void OpenFileBrowser(const std::string &start_path);
    void OnSaveFileSelected(const std::string &path);
    bool RefreshPartyData(std::string *error);
    bool LoadPcStream(std::string *error);
    void RefreshSelectedPcMon();
    bool SaveCurrentSession(std::string *error);
    void UpdateDirtyUi();
    void RebuildHomeMenu();
    void RebuildPartyMenu();
    void RebuildPokemonSectionsMenu();
    void RebuildPokemonFieldsMenu(int section_index);
    void RebuildPcFieldsMenu(int section_index);
    void RebuildMoveListMenu();
    void RebuildMoveEditMenu();
    void RebuildMoneyMenu();
    void RebuildPcBoxListMenu();
    void RebuildPcBoxMenu();
    void RebuildBagMenu();
    void RebuildBagPocketMenu();
    void RebuildRtcMenu();
    void HandleRtcQuickFix();
    void HandleRtcPairRepair();
    void HandleFieldEdit(int section_index, const std::string &field_key);
    void HandlePcFieldEdit(int section_index, const std::string &field_key);
    void HandleMoveSlotEdit(const std::string &field_key);
    void HandleBagSlotEdit(int slot_index);
    void OpenSelectedPartyPage();
    void OpenSelectedSectionPage(int section_index);
    void OpenMoveSlotPage(int slot);
    void OpenPcMonPage(int box, int slot);
    void OpenBagPocketPage(const std::string &pocket_type);
    void ShowSaveToast(const std::string &msg);
    void ShowLayoutScreen(pu::ui::Layout::Ref layout);
    bool PopLayoutScreen();

    std::string GetDbName(const std::unordered_map<int, std::string> &db, int id) const;
    pu::sdl2::TextureHandle::Ref LoadTextureHandle(const std::string &path) const;
    pu::sdl2::TextureHandle::Ref GetPokemonIcon(uint16_t species_id);
    pu::sdl2::TextureHandle::Ref GetItemIcon(uint16_t item_id);
    std::string ShowKeyboardInput(const std::string &guide_text, const std::string &initial_text, uint32_t max_len, size_t out_len) const;
    bool PromptNumber(const std::string &title, const std::string &initial, int min_value, int max_value, int *out_value) const;
    bool PromptCatalogChoice(
        const std::string &title,
        const std::unordered_map<int, std::string> &catalog,
        int current_id,
        int *out_id
    );
    bool PromptNatureChoice(int current_nature_id, int *out_nature_id);

  public:
    using Application::Application;
    PU_SMART_CTOR(MainApplication)
    void OnLoad() override;
};

} // namespace puse::ui

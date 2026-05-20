#include <MainApplication.hpp>

#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <cstdio>
#include <dirent.h>
#include <fstream>
#include <functional>
#include <optional>
#include <regex>
#include <sstream>
#include <sys/stat.h>
#include <switch.h>

#include <puse/core/Money.hpp>
#include <puse/core/Pc.hpp>
#include <puse/core/SaveSession.hpp>
#include <puse/io/DataLoader.hpp>

namespace {

struct UiMetrics {
    s32 screen_w;
    s32 screen_h;
    s32 header_h;
    s32 footer_h;
    s32 content_y;
    s32 content_h;
    s32 pad;
};

UiMetrics GetUiMetrics() {
    const s32 sw = static_cast<s32>(pu::ui::render::ScreenWidth);
    const s32 sh = static_cast<s32>(pu::ui::render::ScreenHeight);
    const s32 pad = std::max(22, sw / 64);
    const s32 header_h = std::max(92, sh / 8);
    const s32 footer_h = std::max(66, sh / 11);
    const s32 content_y = header_h;
    const s32 content_h = sh - header_h - footer_h;
    return {sw, sh, header_h, footer_h, content_y, content_h, pad};
}

std::string TruncateText(const std::string &value, const size_t max_len) {
    if (value.size() <= max_len) {
        return value;
    }
    return value.substr(0, max_len - 3) + "...";
}

bool StartsWith(const std::string &value, const std::string &prefix) {
    return value.rfind(prefix, 0) == 0;
}

bool EndsWith(const std::string &value, const std::string &suffix) {
    if (value.size() < suffix.size()) {
        return false;
    }
    return value.compare(value.size() - suffix.size(), suffix.size(), suffix) == 0;
}

bool FileExists(const std::string &path) {
    struct stat st {};
    return (stat(path.c_str(), &st) == 0) && S_ISREG(st.st_mode);
}

bool IsDirectory(const std::string &path) {
    struct stat st {};
    return (stat(path.c_str(), &st) == 0) && S_ISDIR(st.st_mode);
}

std::string ToLower(const std::string &value) {
    std::string out = value;
    std::transform(out.begin(), out.end(), out.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return out;
}

std::string NormalizeName(const std::string &value) {
    std::string out;
    out.reserve(value.size());
    for (unsigned char c : value) {
        if (std::isalnum(c)) {
            out.push_back(static_cast<char>(std::tolower(c)));
        }
    }
    return out;
}

std::unordered_set<std::string> TokenizeName(const std::string &value) {
    std::unordered_set<std::string> tokens;
    std::string current;
    for (unsigned char c : value) {
        unsigned char low = static_cast<unsigned char>(std::tolower(c));
        if (std::isalnum(low)) {
            current.push_back(static_cast<char>(low));
        } else if (!current.empty()) {
            tokens.insert(current);
            current.clear();
        }
    }
    if (!current.empty()) {
        tokens.insert(current);
    }
    return tokens;
}

bool LooksUnknownItemName(const std::string &item_name) {
    if (item_name.empty()) {
        return true;
    }
    const std::string low = ToLower(item_name);
    return (low == "unknown") || StartsWith(low, "item ") || StartsWith(low, "id ");
}

std::string ToPascalFromToken(const std::string &token) {
    std::string out;
    bool upper_next = true;
    for (unsigned char c : token) {
        if (c == '_') {
            upper_next = true;
            continue;
        }
        out.push_back(static_cast<char>(upper_next ? std::toupper(c) : std::tolower(c)));
        upper_next = false;
    }
    return out;
}

std::vector<std::string> PokemonIconSearchRoots() {
    return {
        "romfs:/icons/pokemon",
        "sdmc:/switch/puse/icons/pokemon",
        "sdmc:/switch/puse/romfs/icons/pokemon",
    };
}

std::vector<std::string> ItemIconSearchRoots() {
    return {
        "romfs:/icons/items",
        "sdmc:/switch/puse/icons/items",
        "sdmc:/switch/puse/romfs/icons/items",
    };
}

} // namespace

namespace puse::ui {

BasePageLayout::BasePageLayout(const UiTheme &theme, const std::string &title, pu::sdl2::TextureHandle::Ref icon)
    : Layout(), theme_(theme) {
    const auto ui = GetUiMetrics();
    this->SetBackgroundColor(theme_.page_bg);

    this->header_bg_ = pu::ui::elm::Rectangle::New(0, 0, ui.screen_w, ui.header_h, theme_.header_bg);
    this->footer_bg_ = pu::ui::elm::Rectangle::New(0, ui.screen_h - ui.footer_h, ui.screen_w, ui.footer_h, theme_.footer_bg);

    const s32 icon_size = ui.header_h - (2 * ui.pad / 3);
    this->header_icon_ = pu::ui::elm::Image::New(ui.pad, (ui.header_h - icon_size) / 2, icon);
    this->header_icon_->SetWidth(icon_size);
    this->header_icon_->SetHeight(icon_size);

    this->title_text_ = pu::ui::elm::TextBlock::New((2 * ui.pad) + icon_size, ui.pad / 3, title);
    this->title_text_->SetColor(theme_.text_primary);
    this->title_text_->SetFont(pu::ui::GetDefaultFont(pu::ui::DefaultFontSize::MediumLarge));

    this->subtitle_text_ = pu::ui::elm::TextBlock::New((2 * ui.pad) + icon_size, ui.header_h / 2, "");
    this->subtitle_text_->SetColor(theme_.text_secondary);
    this->subtitle_text_->SetFont(pu::ui::GetDefaultFont(pu::ui::DefaultFontSize::Small));

    this->hints_text_ = pu::ui::elm::TextBlock::New(ui.pad, ui.screen_h - ui.footer_h + (ui.footer_h / 4), "");
    this->hints_text_->SetColor(theme_.text_secondary);
    this->hints_text_->SetFont(pu::ui::GetDefaultFont(pu::ui::DefaultFontSize::Medium));

    this->Add(this->header_bg_);
    this->Add(this->footer_bg_);
    this->Add(this->header_icon_);
    this->Add(this->title_text_);
    this->Add(this->subtitle_text_);
    this->Add(this->hints_text_);
}

void BasePageLayout::SetTitle(const std::string &title) {
    this->title_text_->SetText(title);
}

void BasePageLayout::SetSubtitle(const std::string &subtitle) {
    this->subtitle_text_->SetText(subtitle);
}

void BasePageLayout::SetHints(const std::string &hints) {
    this->hints_text_->SetText(hints);
}

HomeLayout::HomeLayout(const UiTheme &theme, pu::sdl2::TextureHandle::Ref header_icon)
    : BasePageLayout(theme, "PUSE", header_icon) {
    const auto ui = GetUiMetrics();
    this->SetSubtitle("Pokemon Unbound Save Editor");
    this->SetHints("[A] Select   [+] Exit");

    const s32 menu_x = ui.pad;
    const s32 menu_y = ui.content_y + ui.pad;
    const s32 menu_w = ui.screen_w - (2 * ui.pad);
    const s32 menu_h = ui.content_h - (2 * ui.pad);
    const s32 item_h = std::max(90, menu_h / 3);
    this->menu_ = pu::ui::elm::Menu::New(menu_x, menu_y, menu_w, theme_.menu_item, theme_.menu_focus, item_h, 3);
    this->Add(this->menu_);
}

pu::ui::elm::Menu::Ref HomeLayout::GetMenu() {
    return this->menu_;
}

PartyListLayout::PartyListLayout(const UiTheme &theme, pu::sdl2::TextureHandle::Ref header_icon)
    : BasePageLayout(theme, "Party", header_icon) {
    const auto ui = GetUiMetrics();
    this->SetSubtitle("Choose a Pokemon slot");
    this->SetHints("[A] Open   [B] Back   [X] Save   [+] Exit");

    const s32 menu_x = ui.pad;
    const s32 menu_y = ui.content_y + ui.pad;
    const s32 menu_w = ui.screen_w - (2 * ui.pad);
    const s32 menu_h = ui.content_h - (2 * ui.pad);
    const s32 item_h = std::max(74, menu_h / 6);
    this->menu_ = pu::ui::elm::Menu::New(menu_x, menu_y, menu_w, theme_.menu_item, theme_.menu_focus, item_h, 6);
    this->Add(this->menu_);
}

pu::ui::elm::Menu::Ref PartyListLayout::GetMenu() {
    return this->menu_;
}

PokemonSectionsLayout::PokemonSectionsLayout(const UiTheme &theme, pu::sdl2::TextureHandle::Ref header_icon)
    : BasePageLayout(theme, "Pokemon", header_icon) {
    const auto ui = GetUiMetrics();
    this->SetHints("[A] Open Section   [B] Back   [X] Save   [+] Exit");

    const s32 menu_x = ui.pad;
    const s32 menu_y = ui.content_y + ui.pad;
    const s32 icon_size = std::max(164, ui.content_h / 3);
    const s32 icon_x = ui.screen_w - ui.pad - icon_size;
    const s32 icon_y = ui.content_y + ui.pad;
    const s32 menu_w = icon_x - (2 * ui.pad);
    const s32 menu_h = ui.content_h - (2 * ui.pad);
    const s32 item_h = std::max(68, menu_h / 5);

    this->mon_icon_ = pu::ui::elm::Image::New(icon_x, icon_y, pu::sdl2::TextureHandle::New());
    this->mon_icon_->SetWidth(icon_size);
    this->mon_icon_->SetHeight(icon_size);
    this->sections_menu_ = pu::ui::elm::Menu::New(menu_x, menu_y, menu_w, theme_.menu_item, theme_.menu_focus, item_h, 5);

    this->Add(this->sections_menu_);
    this->Add(this->mon_icon_);
}

pu::ui::elm::Menu::Ref PokemonSectionsLayout::GetMenu() {
    return this->sections_menu_;
}

void PokemonSectionsLayout::SetPokemonHeader(const core::PartyEntry &entry, pu::sdl2::TextureHandle::Ref icon, const bool dirty) {
    std::string name = entry.nickname.empty() ? entry.species_name : entry.nickname;
    if (dirty) {
        name += "  [Unsaved]";
    }
    this->title_text_->SetText(name);

    std::string sub = "Slot #" + std::to_string(entry.index + 1)
        + "   Lv " + std::to_string(static_cast<int>(entry.level))
        + "   " + entry.nature_name;
    if (entry.is_shiny) {
        sub += "   [Shiny]";
    }
    if (!entry.gender.empty() && entry.gender != "Genderless") {
        sub += "   " + entry.gender;
    }
    this->SetSubtitle(sub);
    this->mon_icon_->SetImage(icon);
}

PokemonFieldsLayout::PokemonFieldsLayout(const UiTheme &theme, pu::sdl2::TextureHandle::Ref header_icon)
    : BasePageLayout(theme, "Pokemon Section", header_icon) {
    const auto ui = GetUiMetrics();
    this->SetHints("[A] Edit   [B] Back   [X] Save   [+] Exit");

    const s32 menu_x = ui.pad;
    const s32 menu_y = ui.content_y + ui.pad;
    const s32 menu_w = ui.screen_w - (2 * ui.pad);
    const s32 menu_h = ui.content_h - (2 * ui.pad);
    const s32 item_h = std::max(72, menu_h / 6);
    this->fields_menu_ = pu::ui::elm::Menu::New(menu_x, menu_y, menu_w, theme_.menu_item, theme_.menu_focus, item_h, 6);

    this->Add(this->fields_menu_);
}

pu::ui::elm::Menu::Ref PokemonFieldsLayout::GetMenu() {
    return this->fields_menu_;
}

void PokemonFieldsLayout::SetSectionHeader(const std::string &pokemon_name, const std::string &section_name) {
    this->title_text_->SetText(section_name);
    this->SetSubtitle(pokemon_name);
}

DiagnosticsLayout::DiagnosticsLayout(const UiTheme &theme, pu::sdl2::TextureHandle::Ref header_icon)
    : BasePageLayout(theme, "Diagnostics", header_icon) {
    this->SetHints("[B] Back   [X] Save   [+] Exit");
}

void DiagnosticsLayout::SetLines(const std::vector<std::string> &lines) {
    const auto ui = GetUiMetrics();
    for (auto &row : this->lines_) {
        row->SetVisible(false);
    }
    this->lines_.clear();

    int y = ui.content_y + ui.pad;
    for (const auto &line : lines) {
        auto t = pu::ui::elm::TextBlock::New(ui.pad, y, line);
        t->SetColor(this->theme_.text_primary);
        t->SetFont(pu::ui::GetDefaultFont(pu::ui::DefaultFontSize::Medium));
        this->lines_.push_back(t);
        this->Add(t);
        y += 48;
    }
}

PokemonMoveListLayout::PokemonMoveListLayout(const UiTheme &theme, pu::sdl2::TextureHandle::Ref header_icon)
    : BasePageLayout(theme, "Moves", header_icon) {
    const auto ui = GetUiMetrics();
    this->SetSubtitle("Select a move slot to edit");
    this->SetHints("[A] Edit Slot   [B] Back   [X] Save   [+] Exit");

    const s32 menu_x = ui.pad;
    const s32 menu_y = ui.content_y + ui.pad;
    const s32 menu_w = ui.screen_w - (2 * ui.pad);
    const s32 menu_h = ui.content_h - (2 * ui.pad);
    const s32 item_h = std::max(82, menu_h / 4);
    this->move_list_menu_ = pu::ui::elm::Menu::New(menu_x, menu_y, menu_w, theme.menu_item, theme.menu_focus, item_h, 4);
    this->Add(this->move_list_menu_);
}

pu::ui::elm::Menu::Ref PokemonMoveListLayout::GetMenu() {
    return this->move_list_menu_;
}

PokemonMoveEditLayout::PokemonMoveEditLayout(const UiTheme &theme, pu::sdl2::TextureHandle::Ref header_icon)
    : BasePageLayout(theme, "Move Slot", header_icon) {
    const auto ui = GetUiMetrics();
    this->SetHints("[A] Edit   [B] Back   [X] Save   [+] Exit");

    const s32 menu_x = ui.pad;
    const s32 menu_y = ui.content_y + ui.pad;
    const s32 menu_w = ui.screen_w - (2 * ui.pad);
    const s32 menu_h = ui.content_h - (2 * ui.pad);
    const s32 item_h = std::max(90, menu_h / 4);
    this->move_edit_menu_ = pu::ui::elm::Menu::New(menu_x, menu_y, menu_w, theme.menu_item, theme.menu_focus, item_h, 3);
    this->Add(this->move_edit_menu_);
}

pu::ui::elm::Menu::Ref PokemonMoveEditLayout::GetMenu() {
    return this->move_edit_menu_;
}

void PokemonSectionsLayout::SetMonIcon(pu::sdl2::TextureHandle::Ref icon) {
    this->mon_icon_->SetImage(icon);
}

void PokemonMoveEditLayout::SetMoveSlotHeader(const std::string &pokemon_name, const int slot) {
    this->title_text_->SetText("Move Slot " + std::to_string(slot + 1));
    this->SetSubtitle(pokemon_name);
}

MoneyEditLayout::MoneyEditLayout(const UiTheme &theme, pu::sdl2::TextureHandle::Ref header_icon)
    : BasePageLayout(theme, "Money", header_icon) {
    const auto ui = GetUiMetrics();
    this->SetSubtitle("Current trainer money");
    this->SetHints("[A] Edit   [B] Back   [X] Save   [+] Exit");

    const s32 menu_x = ui.pad;
    const s32 menu_y = ui.content_y + ui.pad;
    const s32 menu_w = ui.screen_w - (2 * ui.pad);
    const s32 menu_h = ui.content_h - (2 * ui.pad);
    const s32 item_h = std::max(90, menu_h / 3);
    this->menu_ = pu::ui::elm::Menu::New(menu_x, menu_y, menu_w, theme_.menu_item, theme_.menu_focus, item_h, 3);
    this->Add(this->menu_);
}

pu::ui::elm::Menu::Ref MoneyEditLayout::GetMenu() {
    return this->menu_;
}

PcBoxListLayout::PcBoxListLayout(const UiTheme &theme, pu::sdl2::TextureHandle::Ref header_icon)
    : BasePageLayout(theme, "PC", header_icon) {
    const auto ui = GetUiMetrics();
    this->SetSubtitle("Select a box");
    this->SetHints("[A] Open Box   [B] Back   [X] Save   [+] Exit");

    const s32 menu_x = ui.pad;
    const s32 menu_y = ui.content_y + ui.pad;
    const s32 menu_w = ui.screen_w - (2 * ui.pad);
    const s32 menu_h = ui.content_h - (2 * ui.pad);
    const s32 item_h = std::max(56, menu_h / 9);
    this->menu_ = pu::ui::elm::Menu::New(menu_x, menu_y, menu_w, theme_.menu_item, theme_.menu_focus, item_h, 9);
    this->Add(this->menu_);
}

pu::ui::elm::Menu::Ref PcBoxListLayout::GetMenu() {
    return this->menu_;
}

PcBoxLayout::PcBoxLayout(const UiTheme &theme, pu::sdl2::TextureHandle::Ref header_icon)
    : BasePageLayout(theme, "Box", header_icon) {
    const auto ui = GetUiMetrics();
    this->SetHints("[A] Edit   [B] Back   [X] Save   [+] Exit");

    const s32 menu_x = ui.pad;
    const s32 menu_y = ui.content_y + ui.pad;
    const s32 menu_w = ui.screen_w - (2 * ui.pad);
    const s32 menu_h = ui.content_h - (2 * ui.pad);
    const s32 item_h = std::max(52, menu_h / 10);
    this->menu_ = pu::ui::elm::Menu::New(menu_x, menu_y, menu_w, theme_.menu_item, theme_.menu_focus, item_h, 10);
    this->Add(this->menu_);
}

pu::ui::elm::Menu::Ref PcBoxLayout::GetMenu() {
    return this->menu_;
}

void MainApplication::ConfigureTheme() {
    this->theme_.page_bg = {16, 22, 35, 0xFF};
    this->theme_.header_bg = {12, 17, 29, 0xFF};
    this->theme_.footer_bg = {12, 17, 29, 0xFF};
    this->theme_.panel_bg = {28, 38, 58, 0xFF};
    this->theme_.text_primary = {240, 246, 255, 0xFF};
    this->theme_.text_secondary = {191, 205, 226, 0xFF};
    this->theme_.accent = {236, 74, 80, 0xFF};
    this->theme_.menu_item = {44, 56, 79, 0xFF};
    this->theme_.menu_focus = {0, 120, 214, 0xFF};
}

bool MainApplication::LoadSpeciesIdTokens() {
    this->species_id_tokens_.clear();

    const std::string path = io::ResolveAssetPath("data/species_id.txt");
    if (path.empty()) {
        return false;
    }

    std::ifstream in(path);
    if (!in.good()) {
        return false;
    }

    std::string line;
    while (std::getline(in, line)) {
        if (!StartsWith(line, "SPECIES_")) {
            continue;
        }

        std::istringstream iss(line);
        std::string first;
        iss >> first;
        if (!StartsWith(first, "SPECIES_")) {
            continue;
        }
        const std::string token = first.substr(std::string("SPECIES_").size());

        std::string part;
        while (iss >> part) {
            if (!StartsWith(ToLower(part), "0x")) {
                continue;
            }
            char *end = nullptr;
            const long sid_long = std::strtol(part.c_str(), &end, 16);
            if ((end != nullptr) && (*end == '\0')) {
                const int sid = static_cast<int>(sid_long);
                this->species_id_tokens_[sid] = token;
            }
            break;
        }
    }

    return !this->species_id_tokens_.empty();
}

void MainApplication::BuildItemIconIndex() {
    if (this->item_index_ready_) {
        return;
    }

    auto add_file = [&](const std::string &path) {
        const std::string file_name = path.substr(path.find_last_of("/\\") + 1);
        const size_t dot = file_name.find_last_of('.');
        const std::string stem = (dot == std::string::npos) ? file_name : file_name.substr(0, dot);
        const std::string norm = NormalizeName(stem);
        if (!norm.empty() && (this->item_norm_to_path_.find(norm) == this->item_norm_to_path_.end())) {
            this->item_norm_to_path_[norm] = path;
        }

        auto tokens = TokenizeName(stem);
        if (!tokens.empty()) {
            this->item_token_index_.push_back(std::make_tuple(tokens, norm, path));
        }
    };

    std::function<void(const std::string &)> walk_pngs = [&](const std::string &root) {
        DIR *dir = opendir(root.c_str());
        if (dir == nullptr) {
            return;
        }
        struct dirent *ent;
        while ((ent = readdir(dir)) != nullptr) {
            const std::string name = ent->d_name;
            if (name == "." || name == "..") {
                continue;
            }

            const std::string full = root + "/" + name;
            if (IsDirectory(full)) {
                walk_pngs(full);
            } else if (EndsWith(ToLower(name), ".png")) {
                add_file(full);
            }
        }
        closedir(dir);
    };

    for (const auto &root : ItemIconSearchRoots()) {
        if (!IsDirectory(root)) {
            continue;
        }

        const std::string base_items = root + "/Base Items";
        if (IsDirectory(base_items)) {
            walk_pngs(base_items);
        }

        DIR *dir = opendir(root.c_str());
        if (dir != nullptr) {
            struct dirent *ent;
            while ((ent = readdir(dir)) != nullptr) {
                const std::string name = ent->d_name;
                if (name == "." || name == "..") {
                    continue;
                }
                const std::string folder = root + "/" + name;
                if (!IsDirectory(folder) || (folder == base_items)) {
                    continue;
                }
                walk_pngs(folder);
            }
            closedir(dir);
        }
    }

    this->item_index_ready_ = true;
}

std::string MainApplication::GetDbName(const std::unordered_map<int, std::string> &db, const int id) const {
    const auto it = db.find(id);
    return (it == db.end()) ? "Unknown" : it->second;
}

pu::sdl2::TextureHandle::Ref MainApplication::LoadTextureHandle(const std::string &path) const {
    auto tex = pu::ui::render::LoadImageFromFile(path);
    return tex ? pu::sdl2::TextureHandle::New(tex) : nullptr;
}

pu::sdl2::TextureHandle::Ref MainApplication::GetPokemonIcon(const uint16_t species_id) {
    auto cache_it = this->pokemon_icon_cache_.find(species_id);
    if (cache_it != this->pokemon_icon_cache_.end()) {
        return cache_it->second;
    }

    char id_buf[8];
    std::snprintf(id_buf, sizeof(id_buf), "%03u", species_id);
    const std::string prefix = std::string("gFrontSprite") + id_buf;

    auto find_by_prefix = [&](const std::string &root) -> std::string {
        DIR *dir = opendir(root.c_str());
        if (dir == nullptr) {
            return "";
        }

        std::string found;
        struct dirent *ent;
        while ((ent = readdir(dir)) != nullptr) {
            const std::string name = ent->d_name;
            if (!EndsWith(ToLower(name), ".png") || !StartsWith(name, prefix)) {
                continue;
            }
            const std::string rem = name.substr(prefix.size());
            if (!rem.empty() && std::isdigit(static_cast<unsigned char>(rem[0]))) {
                continue;
            }
            found = root + "/" + name;
            break;
        }
        closedir(dir);
        return found;
    };

    std::string found_path;
    for (const auto &root : PokemonIconSearchRoots()) {
        found_path = find_by_prefix(root);
        if (!found_path.empty()) {
            break;
        }
    }

    if (found_path.empty()) {
        auto tok_it = this->species_id_tokens_.find(static_cast<int>(species_id));
        if (tok_it != this->species_id_tokens_.end()) {
            const std::string token = tok_it->second;
            std::vector<std::string> candidates;

            if (token == "FLAPPLE_GIGA" || token == "APPLETUN_GIGA") {
                candidates.push_back("gFrontSpriteGigaFlappletun.png");
            } else if (token == "TOXTRICITY_LOW_KEY_GIGA") {
                candidates.push_back("gFrontSpriteGigaToxtricity.png");
            } else if (EndsWith(token, "_GIGA")) {
                candidates.push_back("gFrontSpriteGiga" + ToPascalFromToken(token.substr(0, token.size() - 5)) + ".png");
            }

            for (const auto &root : PokemonIconSearchRoots()) {
                for (const auto &name : candidates) {
                    const std::string probe = root + "/" + name;
                    if (FileExists(probe)) {
                        found_path = probe;
                        break;
                    }
                }
                if (!found_path.empty()) {
                    break;
                }
            }
        }
    }

    pu::sdl2::TextureHandle::Ref icon = pu::sdl2::TextureHandle::New();
    if (!found_path.empty()) {
        icon = LoadTextureHandle(found_path);
    }

    this->pokemon_icon_cache_[species_id] = icon;
    return icon;
}

pu::sdl2::TextureHandle::Ref MainApplication::GetItemIcon(const uint16_t item_id) {
    if (item_id == 0) {
        return nullptr;
    }

    auto cache_it = this->item_icon_cache_.find(item_id);
    if (cache_it != this->item_icon_cache_.end()) {
        return cache_it->second;
    }

    BuildItemIconIndex();
    pu::sdl2::TextureHandle::Ref icon = nullptr;

    const std::string item_name = GetDbName(this->items_db_, item_id);
    if (!LooksUnknownItemName(item_name)) {
        const std::string norm = NormalizeName(item_name);

        auto direct_it = this->item_norm_to_path_.find(norm);
        if (direct_it != this->item_norm_to_path_.end()) {
            icon = LoadTextureHandle(direct_it->second);
        } else {
            const auto target_tokens = TokenizeName(item_name);
            for (const auto &entry : this->item_token_index_) {
                if (std::get<0>(entry) == target_tokens) {
                    icon = LoadTextureHandle(std::get<2>(entry));
                    break;
                }
            }

            if ((icon == nullptr) || (icon->Get() == nullptr)) {
                std::smatch match;
                std::regex hm_re("HM\\s*0?(\\d{1,2})", std::regex_constants::icase);
                std::regex tm_re("TM\\s*0?(\\d{1,3})", std::regex_constants::icase);
                if (std::regex_search(item_name, match, hm_re)) {
                    const int n = std::stoi(match[1].str());
                    const std::vector<std::string> keys = {
                        std::string("hm") + (n < 10 ? "0" : "") + std::to_string(n),
                        std::string("hm") + std::to_string(n),
                    };
                    for (const auto &k : keys) {
                        auto it = this->item_norm_to_path_.find(k);
                        if (it != this->item_norm_to_path_.end()) {
                            icon = LoadTextureHandle(it->second);
                            break;
                        }
                    }
                } else if (std::regex_search(item_name, match, tm_re)) {
                    const int n = std::stoi(match[1].str());
                    const std::vector<std::string> keys = {
                        std::string("tm") + (n < 10 ? "0" : "") + std::to_string(n),
                        std::string("tm") + (n < 100 ? "0" : "") + std::to_string(n),
                        std::string("tm") + std::to_string(n),
                    };
                    for (const auto &k : keys) {
                        auto it = this->item_norm_to_path_.find(k);
                        if (it != this->item_norm_to_path_.end()) {
                            icon = LoadTextureHandle(it->second);
                            break;
                        }
                    }
                }
            }
        }
    }

    this->item_icon_cache_[item_id] = icon;
    return icon;
}

bool MainApplication::RefreshPartyData(std::string *error) {
    const std::string species_path = io::ResolveAssetPath("data/pokemon.txt");
    const std::string items_path = io::ResolveAssetPath("data/items.txt");
    const std::string moves_path = io::ResolveAssetPath("data/moves.txt");

    if (species_path.empty() || items_path.empty() || moves_path.empty()) {
        if (error != nullptr) {
            *error = "missing ROMFS data files";
        }
        return false;
    }

    this->species_db_ = io::LoadIdNameFile(species_path);
    this->items_db_ = io::LoadIdNameFile(items_path);
    this->moves_db_ = io::LoadIdNameFile(moves_path);
    this->LoadSpeciesIdTokens();

    if (!puse::core::EnsurePartyStaticDataLoaded(error)) {
        return false;
    }

    if (!this->save_session_.LoadFromFile("sdmc:/switch/puse/Unbound.sav", error)) {
        return false;
    }

    this->party_ = puse::core::ParseParty(this->save_session_.Buffer(), this->species_db_);
    this->dirty_ = false;
    return true;
}

bool MainApplication::LoadPcStream(std::string *error) {
    if (!this->save_session_.IsLoaded()) {
        if (error) { *error = "save not loaded"; }
        return false;
    }
    std::string stream_error;
    this->pc_stream_ = puse::core::BuildPcStream(this->save_session_.Buffer(), &stream_error);
    if (this->pc_stream_.empty()) {
        if (error) { *error = stream_error; }
        return false;
    }
    return true;
}

void MainApplication::RefreshSelectedPcMon() {
    if ((this->selected_pc_box_ < 1) || (this->selected_pc_slot_ < 1)) { return; }
    const auto mons = puse::core::ParsePcBox(this->pc_stream_, this->selected_pc_box_, this->species_db_);
    for (const auto &m : mons) {
        if (m.slot == this->selected_pc_slot_) {
            this->selected_pc_mon_ = m;
            return;
        }
    }
}

bool MainApplication::SaveCurrentSession(std::string *error) {
    if (!this->save_session_.IsLoaded()) {
        if (error != nullptr) {
            *error = "save session is not loaded";
        }
        return false;
    }

    // Commit PC stream back to save buffer before checksums.
    if (this->pc_stream_loaded_ && !this->pc_stream_.empty()) {
        if (!puse::core::CommitPcStream(this->save_session_.MutableBuffer(), this->pc_stream_, error)) {
            return false;
        }
    }

    if (!puse::core::CommitPartySectionChecksums(this->save_session_.MutableBuffer(), error)) {
        return false;
    }

    std::string out_path = this->save_session_.SourcePath();
    if (out_path.empty()) {
        out_path = "sdmc:/switch/puse/Unbound.sav";
    }

    if (!this->save_session_.ExportToFile(out_path, error)) {
        return false;
    }

    this->dirty_ = false;
    this->UpdateDirtyUi();
    return true;
}

void MainApplication::UpdateDirtyUi() {
    const std::string dirty_suffix = this->dirty_ ? "   *Unsaved" : "";
    this->home_layout_->SetHints("[A] Select   [+] Exit" + dirty_suffix);
    this->party_list_layout_->SetHints("[A] Open   [B] Back   [X] Save   [+] Exit" + dirty_suffix);
    this->pokemon_sections_layout_->SetHints("[A] Open Section   [B] Back   [X] Save   [+] Exit" + dirty_suffix);
    this->pokemon_fields_layout_->SetHints("[A] Edit   [B] Back   [X] Save   [+] Exit" + dirty_suffix);
    this->pokemon_move_list_layout_->SetHints("[A] Edit Slot   [B] Back   [X] Save   [+] Exit" + dirty_suffix);
    this->pokemon_move_edit_layout_->SetHints("[A] Edit   [B] Back   [X] Save   [+] Exit" + dirty_suffix);
    this->money_edit_layout_->SetHints("[A] Edit   [B] Back   [X] Save   [+] Exit" + dirty_suffix);
    this->pc_box_list_layout_->SetHints("[A] Open Box   [B] Back   [X] Save   [+] Exit" + dirty_suffix);
    this->pc_box_layout_->SetHints("[A] Edit   [B] Back   [X] Save   [+] Exit" + dirty_suffix);
    this->diagnostics_layout_->SetHints("[B] Back   [X] Save   [+] Exit" + dirty_suffix);

    if (!this->party_.empty()) {
        this->party_list_layout_->SetSubtitle("Loaded " + std::to_string(this->party_.size()) + " slot(s)" + (this->dirty_ ? "   [Unsaved]" : ""));
    }
}

std::string MainApplication::ShowKeyboardInput(const std::string &guide_text, const std::string &initial_text, const uint32_t max_len, const size_t out_len) const {
    SwkbdConfig kbd;
    Result rc = swkbdCreate(&kbd, 0);
    if (R_FAILED(rc)) {
        return "";
    }

    swkbdConfigMakePresetDefault(&kbd);
    swkbdConfigSetType(&kbd, SwkbdType_All);
    swkbdConfigSetStringLenMax(&kbd, max_len);
    if (!guide_text.empty()) {
        swkbdConfigSetGuideText(&kbd, guide_text.c_str());
    }
    if (!initial_text.empty()) {
        swkbdConfigSetInitialText(&kbd, initial_text.c_str());
    }

    std::vector<char> out(out_len + 1, 0);
    rc = swkbdShow(&kbd, out.data(), out.size());
    swkbdClose(&kbd);
    if (R_FAILED(rc)) {
        return "";
    }

    return std::string(out.data());
}

bool MainApplication::PromptNumber(const std::string &title, const std::string &initial, const int min_value, const int max_value, int *out_value) const {
    const std::string typed = ShowKeyboardInput(title, initial, 10, 16);
    if (typed.empty()) {
        return false;
    }

    char *end = nullptr;
    const long parsed = std::strtol(typed.c_str(), &end, 10);
    if ((end == nullptr) || (*end != '\0')) {
        return false;
    }

    const int value = static_cast<int>(std::clamp(parsed, static_cast<long>(min_value), static_cast<long>(max_value)));
    *out_value = value;
    return true;
}

bool MainApplication::PromptCatalogChoice(
    const std::string &title,
    const std::unordered_map<int, std::string> &catalog,
    const int current_id,
    int *out_id
) {
    const std::string query = ShowKeyboardInput(title + " search", "", 24, 64);
    if (query.empty()) {
        return false;
    }

    const std::string query_low = ToLower(query);
    const bool query_numeric = std::all_of(query.begin(), query.end(), [](const unsigned char c) { return std::isdigit(c) != 0; });
    int query_id = -1;
    if (query_numeric) {
        query_id = std::atoi(query.c_str());
    }

    std::vector<std::pair<int, std::string>> matches;
    matches.reserve(32);
    for (const auto &[id, name] : catalog) {
        const bool id_match = query_numeric && (id == query_id);
        const bool name_match = ToLower(name).find(query_low) != std::string::npos;
        if (id_match || name_match) {
            matches.push_back({id, name});
        }
    }

    if (matches.empty()) {
        this->CreateShowDialog(title, "No matches for '" + query + "'", {"OK"}, true);
        return false;
    }

    std::sort(matches.begin(), matches.end(), [](const auto &a, const auto &b) {
        return a.first < b.first;
    });

    const size_t max_options = 12;
    const size_t take = std::min(max_options, matches.size());
    std::vector<std::string> options;
    options.reserve(take + 1);
    for (size_t i = 0; i < take; ++i) {
        const std::string line = std::to_string(matches[i].first) + "  " + TruncateText(matches[i].second, 26);
        options.push_back(line);
    }
    options.push_back("Cancel");

    std::string content = "Select result";
    if (current_id >= 0) {
        content = "Current ID: " + std::to_string(current_id);
    }
    if (matches.size() > max_options) {
        content += "\nShowing first " + std::to_string(max_options) + " of " + std::to_string(matches.size());
    }

    const int selected = this->CreateShowDialog(title, content, options, true);
    if ((selected < 0) || (static_cast<size_t>(selected) >= take)) {
        return false;
    }

    *out_id = matches[static_cast<size_t>(selected)].first;
    return true;
}

bool MainApplication::PromptNatureChoice(const int current_nature_id, int *out_nature_id) {
    static const std::vector<std::string> natures = {
        "Hardy", "Lonely", "Brave", "Adamant", "Naughty",
        "Bold", "Docile", "Relaxed", "Impish", "Lax",
        "Timid", "Hasty", "Serious", "Jolly", "Naive",
        "Modest", "Mild", "Quiet", "Bashful", "Rash",
        "Calm", "Gentle", "Sassy", "Careful", "Quirky",
    };
    std::vector<std::string> options;
    options.reserve(natures.size() + 1);
    for (size_t i = 0; i < natures.size(); ++i) {
        const int idx = static_cast<int>(i);
        options.push_back(std::to_string(idx) + "  " + natures[static_cast<size_t>(idx)]);
    }
    options.push_back("Cancel");

    const int selected = this->CreateShowDialog(
        "Nature",
        "Current ID: " + std::to_string(current_nature_id),
        options,
        true
    );
    if ((selected < 0) || (selected >= static_cast<int>(natures.size()))) {
        return false;
    }

    *out_nature_id = selected;
    return true;
}

void MainApplication::RebuildHomeMenu() {
    const auto menu = this->home_layout_->GetMenu();
    menu->ClearItems();

    struct HomeItem { const char *label; const char *desc; };
    const std::vector<HomeItem> items = {
        {"Party",  "Edit your active party (up to 6 Pokemon)"},
        {"PC",     "Browse and edit PC boxes (boxes 1-18)"},
        {"Money",  "Edit trainer money"},
    };

    for (size_t i = 0; i < items.size(); ++i) {
        auto item = pu::ui::elm::MenuItem::New(std::string(items[i].label) + "   " + items[i].desc);
        item->SetColor({255, 255, 255, 255});
        const int idx = static_cast<int>(i);
        item->AddOnKey([this, idx]() {
            if (idx == 0) {
                this->RebuildPartyMenu();
                this->ShowLayoutScreen(this->party_list_layout_);
            } else if (idx == 1) {
                if (!this->pc_stream_loaded_) {
                    this->CreateShowDialog("PC unavailable", "PC sectors could not be loaded from save.", {"OK"}, true);
                    return;
                }
                this->RebuildPcBoxListMenu();
                this->ShowLayoutScreen(this->pc_box_list_layout_);
            } else if (idx == 2) {
                this->RebuildMoneyMenu();
                this->ShowLayoutScreen(this->money_edit_layout_);
            }
        }, HidNpadButton_A);
        menu->AddItem(item);
    }

    menu->ForceReloadItems();
    menu->SetSelectedIndex(0);
}

void MainApplication::RebuildMoneyMenu() {
    const auto menu = this->money_edit_layout_->GetMenu();
    menu->ClearItems();

    uint32_t money = 0;
    if (!puse::core::ReadMoney(this->save_session_.Buffer(), &money, nullptr)) {
        money = 0;
    }

    // Format money with thousands separators.
    const std::string raw = std::to_string(money);
    std::string formatted;
    formatted.reserve(raw.size() + (raw.size() / 3));
    int rem = static_cast<int>(raw.size()) % 3;
    for (int i = 0; i < static_cast<int>(raw.size()); ++i) {
        if ((i > 0) && (((i - rem) % 3) == 0)) { formatted += ','; }
        formatted += raw[static_cast<size_t>(i)];
    }

    auto item = pu::ui::elm::MenuItem::New("Money   $" + formatted);
    item->SetColor({255, 255, 255, 255});
    item->AddOnKey([this, money]() {
        int new_money = 0;
        if (this->PromptNumber("Set money (0-999999999)", std::to_string(money), 0, 999999999, &new_money)) {
            std::string err;
            if (puse::core::WriteMoney(this->save_session_.MutableBuffer(), static_cast<uint32_t>(new_money), &err)) {
                this->dirty_ = true;
                this->UpdateDirtyUi();
                this->RebuildMoneyMenu();
            } else {
                this->CreateShowDialog("Money edit failed", err.empty() ? "Unknown error" : err, {"OK"}, true);
            }
        }
    }, HidNpadButton_A);
    menu->AddItem(item);

    menu->ForceReloadItems();
    menu->SetSelectedIndex(0);
}

void MainApplication::RebuildPcBoxListMenu() {
    const auto menu = this->pc_box_list_layout_->GetMenu();
    menu->ClearItems();

    for (int box = 1; box <= puse::core::kPcStreamBoxCount; ++box) {
        const int count = puse::core::CountPcBoxMons(this->pc_stream_, box);
        std::ostringstream label;
        label << "Box " << box << "   (" << count << " / " << puse::core::kPcBoxSlotCount << " Pokemon)";
        auto item = pu::ui::elm::MenuItem::New(label.str());
        item->SetColor({255, 255, 255, 255});
        const int b = box;
        item->AddOnKey([this, b]() {
            this->selected_pc_box_ = b;
            this->RebuildPcBoxMenu();
            std::string title = "Box " + std::to_string(b);
            this->pc_box_layout_->SetTitle(title);
            const int cnt = puse::core::CountPcBoxMons(this->pc_stream_, b);
            this->pc_box_layout_->SetSubtitle(std::to_string(cnt) + " Pokemon in this box");
            this->ShowLayoutScreen(this->pc_box_layout_);
        }, HidNpadButton_A);
        menu->AddItem(item);
    }

    menu->ForceReloadItems();
    menu->SetSelectedIndex(0);
}

void MainApplication::RebuildPcBoxMenu() {
    const auto menu = this->pc_box_layout_->GetMenu();
    menu->ClearItems();

    if ((this->selected_pc_box_ < 1) || (this->selected_pc_box_ > puse::core::kPcStreamBoxCount)) {
        return;
    }

    // Build slot label map from parsed mons (keyed by slot).
    const auto mons = puse::core::ParsePcBox(this->pc_stream_, this->selected_pc_box_, this->species_db_);
    std::unordered_map<int, const puse::core::PcMon *> slot_map;
    for (const auto &m : mons) { slot_map[m.slot] = &m; }

    for (int slot = 1; slot <= puse::core::kPcBoxSlotCount; ++slot) {
        std::ostringstream label;
        label << slot << ".   ";
        auto sit = slot_map.find(slot);
        if (sit != slot_map.end()) {
            const auto &m = *sit->second;
            const std::string display = m.nickname.empty() ? m.species_name : (m.nickname + " (" + m.species_name + ")");
            label << display << "   Lv " << static_cast<int>(m.level);
            if (m.is_shiny) { label << "   [Shiny]"; }
            if (m.item_id != 0) {
                label << "   @" << TruncateText(GetDbName(this->items_db_, m.item_id), 16);
            }
        } else {
            label << "[empty]";
        }

        auto item = pu::ui::elm::MenuItem::New(label.str());
        item->SetColor({255, 255, 255, 255});
        if (sit != slot_map.end()) {
            item->SetIcon(GetPokemonIcon(sit->second->species_id));
        }
        if (sit != slot_map.end()) {
            const int s = slot;
            item->AddOnKey([this, s]() {
                this->OpenPcMonPage(this->selected_pc_box_, s);
            }, HidNpadButton_A);
        }
        menu->AddItem(item);
    }

    menu->ForceReloadItems();
    menu->SetSelectedIndex(0);
}

void MainApplication::OpenPcMonPage(const int box, const int slot) {
    this->selected_pc_box_ = box;
    this->selected_pc_slot_ = slot;
    this->edit_context_ = EditContext::Pc;
    this->RefreshSelectedPcMon();

    const auto &m = this->selected_pc_mon_;
    std::string name = m.nickname.empty() ? m.species_name : m.nickname;
    if (this->dirty_) { name += "  [Unsaved]"; }
    this->pokemon_sections_layout_->SetTitle(name);

    std::string sub = "Box " + std::to_string(box) + "  Slot " + std::to_string(slot)
        + "   Lv " + std::to_string(static_cast<int>(m.level))
        + "   " + m.nature_name;
    if (m.is_shiny) { sub += "   [Shiny]"; }
    if (!m.gender.empty() && m.gender != "genderless" && m.gender != "unknown") {
        sub += "   " + m.gender;
    }
    this->pokemon_sections_layout_->SetSubtitle(sub);
    this->pokemon_sections_layout_->SetMonIcon(GetPokemonIcon(m.species_id));

    this->RebuildPokemonSectionsMenu();
    this->ShowLayoutScreen(this->pokemon_sections_layout_);
}

void MainApplication::RebuildPcFieldsMenu(const int section_index) {
    const auto &m = this->selected_pc_mon_;
    const auto menu = this->pokemon_fields_layout_->GetMenu();
    menu->ClearItems();

    std::vector<std::pair<std::string, std::string>> rows;
    std::string section_title;

    static const std::array<std::pair<const char *, size_t>, 6> kStatOrder = {{
        {"HP", 0}, {"Atk", 1}, {"Def", 2}, {"SpA", 4}, {"SpD", 5}, {"Spe", 3}
    }};

    if (section_index == 0) {
        section_title = "Summary";
        rows.push_back({"Species", m.species_name});
        rows.push_back({"Nickname", m.nickname.empty() ? "-" : m.nickname});
        rows.push_back({"Level", std::to_string(static_cast<int>(m.level))});
        rows.push_back({"Nature", m.nature_name});
        rows.push_back({"Shiny", m.is_shiny ? "Yes" : "No"});
    } else if (section_index == 1) {
        section_title = "Battle";
        rows.push_back({"Item", GetDbName(this->items_db_, m.item_id)});
        rows.push_back({"Hidden Ability", m.hidden_ability ? "Yes" : "No"});
        rows.push_back({"PID", std::to_string(m.pid)});
        rows.push_back({"OTID", std::to_string(m.otid)});
    } else if (section_index == 2) {
        section_title = "IVs";
        for (const auto &[stat, idx] : kStatOrder) {
            rows.push_back({"IV " + std::string(stat), std::to_string(static_cast<int>(m.ivs[idx]))});
        }
    } else if (section_index == 3) {
        section_title = "EVs";
        int ev_total = 0;
        for (const auto &[stat, idx] : kStatOrder) { ev_total += m.evs[idx]; }
        for (const auto &[stat, idx] : kStatOrder) {
            rows.push_back({"EV " + std::string(stat), std::to_string(static_cast<int>(m.evs[idx]))});
        }
        const std::string mon_name = m.nickname.empty() ? m.species_name : m.nickname;
        this->pokemon_fields_layout_->SetSectionHeader(mon_name, "EVs   [" + std::to_string(ev_total) + "/510]");
        for (const auto &row : rows) {
            auto item = pu::ui::elm::MenuItem::New(row.first + "   " + TruncateText(row.second, 36));
            item->SetColor({255, 255, 255, 255});
            item->AddOnKey([this, row, section_index]() {
                this->HandlePcFieldEdit(section_index, row.first);
            }, HidNpadButton_A);
            menu->AddItem(item);
        }
        menu->ForceReloadItems();
        if (!rows.empty()) { menu->SetSelectedIndex(0); }
        return;
    }

    const std::string mon_name = m.nickname.empty() ? m.species_name : m.nickname;
    this->pokemon_fields_layout_->SetSectionHeader(mon_name, section_title);
    for (const auto &row : rows) {
        auto item = pu::ui::elm::MenuItem::New(row.first + "   " + TruncateText(row.second, 36));
        item->SetColor({255, 255, 255, 255});
        if ((section_index == 1) && (row.first == "Item")) {
            item->SetIcon(GetItemIcon(m.item_id));
        }
        item->AddOnKey([this, row, section_index]() {
            this->HandlePcFieldEdit(section_index, row.first);
        }, HidNpadButton_A);
        menu->AddItem(item);
    }
    menu->ForceReloadItems();
    if (!rows.empty()) { menu->SetSelectedIndex(0); }
}

void MainApplication::HandlePcFieldEdit(const int section_index, const std::string &field_key) {
    const auto &m = this->selected_pc_mon_;
    const int box = this->selected_pc_box_;
    const int slot = this->selected_pc_slot_;
    std::string error;
    bool changed = false;

    static const std::array<std::pair<const char *, size_t>, 6> kIvMap = {{
        {"IV HP", 0}, {"IV Atk", 1}, {"IV Def", 2}, {"IV SpA", 4}, {"IV SpD", 5}, {"IV Spe", 3}
    }};
    static const std::array<std::pair<const char *, size_t>, 6> kEvMap = {{
        {"EV HP", 0}, {"EV Atk", 1}, {"EV Def", 2}, {"EV SpA", 4}, {"EV SpD", 5}, {"EV Spe", 3}
    }};

    if (section_index == 0) {
        if (field_key == "Species") {
            int species_id = 0;
            if (PromptCatalogChoice("Species", this->species_db_, static_cast<int>(m.species_id), &species_id)) {
                changed = puse::core::UpdatePcMonSpecies(this->pc_stream_, box, slot, static_cast<uint16_t>(species_id), &error);
            }
        } else if (field_key == "Nickname") {
            const std::string typed = ShowKeyboardInput("Set nickname", m.nickname, 10, 24);
            if (!typed.empty()) {
                changed = puse::core::UpdatePcMonNickname(this->pc_stream_, box, slot, typed, &error);
            }
        } else if (field_key == "Level") {
            int level = 0;
            if (PromptNumber("Set level (1-100)", std::to_string(static_cast<int>(m.level)), 1, 100, &level)) {
                changed = puse::core::UpdatePcMonLevel(this->pc_stream_, box, slot, level, &error);
            }
        } else if (field_key == "Nature") {
            int nature_id = 0;
            if (PromptNatureChoice(static_cast<int>(m.nature_id), &nature_id)) {
                changed = puse::core::UpdatePcMonNature(this->pc_stream_, box, slot, static_cast<uint8_t>(nature_id), &error);
            }
        } else if (field_key == "Shiny") {
            const int opt = this->CreateShowDialog("Shiny", std::string("Current: ") + (m.is_shiny ? "Shiny" : "Not shiny"),
                {"Set Shiny", "Set Not Shiny", "Cancel"}, true);
            if (opt == 0) {
                changed = puse::core::UpdatePcMonShiny(this->pc_stream_, box, slot, true, &error);
            } else if (opt == 1) {
                changed = puse::core::UpdatePcMonShiny(this->pc_stream_, box, slot, false, &error);
            }
        }
    } else if (section_index == 1) {
        if (field_key == "Item") {
            int item_id = 0;
            if (PromptCatalogChoice("Item", this->items_db_, static_cast<int>(m.item_id), &item_id)) {
                changed = puse::core::UpdatePcMonItem(this->pc_stream_, box, slot, static_cast<uint16_t>(item_id), &error);
            }
        } else if (field_key == "Hidden Ability") {
            const int opt = this->CreateShowDialog("Hidden Ability",
                std::string("Current: ") + (m.hidden_ability ? "Hidden" : "Standard"),
                {"Set Hidden", "Set Standard", "Cancel"}, true);
            if (opt == 0) {
                changed = puse::core::UpdatePcMonHiddenAbility(this->pc_stream_, box, slot, true, &error);
            } else if (opt == 1) {
                changed = puse::core::UpdatePcMonHiddenAbility(this->pc_stream_, box, slot, false, &error);
            }
        }
    } else if (section_index == 2) {
        auto ivs = m.ivs;
        for (const auto &[key, arr_idx] : kIvMap) {
            if (field_key == key) {
                int value = 0;
                if (PromptNumber("Set " + std::string(key), std::to_string(static_cast<int>(ivs[arr_idx])), 0, 31, &value)) {
                    ivs[arr_idx] = static_cast<uint8_t>(value);
                    changed = puse::core::UpdatePcMonIvs(this->pc_stream_, box, slot, ivs, &error);
                }
                break;
            }
        }
    } else if (section_index == 3) {
        auto evs = m.evs;
        for (const auto &[key, arr_idx] : kEvMap) {
            if (field_key == key) {
                int value = 0;
                if (PromptNumber("Set " + std::string(key), std::to_string(static_cast<int>(evs[arr_idx])), 0, 255, &value)) {
                    evs[arr_idx] = static_cast<uint8_t>(value);
                    changed = puse::core::UpdatePcMonEvs(this->pc_stream_, box, slot, evs, &error);
                }
                break;
            }
        }
    }

    if (!error.empty()) {
        this->CreateShowDialog("Edit failed", error, {"OK"}, true);
        return;
    }
    if (!changed) { return; }

    this->dirty_ = true;
    this->UpdateDirtyUi();
    this->RefreshSelectedPcMon();
    this->RebuildPcBoxMenu();
    this->RebuildPcFieldsMenu(section_index);
    // Refresh sections header.
    const auto &nm = this->selected_pc_mon_;
    std::string name = nm.nickname.empty() ? nm.species_name : nm.nickname;
    if (this->dirty_) { name += "  [Unsaved]"; }
    this->pokemon_sections_layout_->SetTitle(name);
    this->pokemon_sections_layout_->SetMonIcon(GetPokemonIcon(nm.species_id));
}

void MainApplication::HandleFieldEdit(const int section_index, const std::string &field_key) {
    if ((this->selected_party_index_ < 0) || (static_cast<size_t>(this->selected_party_index_) >= this->party_.size())) {
        return;
    }

    const auto &entry = this->party_[static_cast<size_t>(this->selected_party_index_)];
    std::string error;
    bool changed = false;

    if (section_index == 0) {
        if (field_key == "Species") {
            int species_id = 0;
            if (PromptCatalogChoice("Species", this->species_db_, static_cast<int>(entry.species_id), &species_id)) {
                changed = puse::core::UpdatePartySpecies(this->save_session_.MutableBuffer(), this->selected_party_index_, static_cast<uint16_t>(species_id), &error);
            }
        } else if (field_key == "Nickname") {
            const std::string typed = ShowKeyboardInput("Set nickname", entry.nickname, 10, 24);
            if (!typed.empty()) {
                changed = puse::core::UpdatePartyNickname(this->save_session_.MutableBuffer(), this->selected_party_index_, typed, &error);
            }
        } else if (field_key == "Level") {
            int level = 0;
            if (PromptNumber("Set level (1-100)", std::to_string(static_cast<int>(entry.level)), 1, 100, &level)) {
                changed = puse::core::UpdatePartyLevel(this->save_session_.MutableBuffer(), this->selected_party_index_, level, std::nullopt, nullptr, &error);
            }
        } else if (field_key == "Nature") {
            int nature_id = 0;
            if (PromptNatureChoice(static_cast<int>(entry.nature_id), &nature_id)) {
                changed = puse::core::UpdatePartyNature(this->save_session_.MutableBuffer(), this->selected_party_index_, static_cast<uint8_t>(nature_id), &error);
            }
        } else if (field_key == "Shiny") {
            const int opt = this->CreateShowDialog(
                "Shiny",
                std::string("Current: ") + (entry.is_shiny ? "Shiny" : "Not shiny"),
                {"Set Shiny", "Set Not Shiny", "Cancel"},
                true
            );
            if (opt == 0) {
                changed = puse::core::UpdatePartyIdentity(this->save_session_.MutableBuffer(), this->selected_party_index_, true, std::nullopt, &error);
            } else if (opt == 1) {
                changed = puse::core::UpdatePartyIdentity(this->save_session_.MutableBuffer(), this->selected_party_index_, false, std::nullopt, &error);
            }
        } else if (field_key == "Gender" && entry.gender_editable) {
            const int opt = this->CreateShowDialog(
                "Gender",
                "Current: " + entry.gender,
                {"Male", "Female", "Cancel"},
                true
            );
            if (opt == 0) {
                changed = puse::core::UpdatePartyIdentity(this->save_session_.MutableBuffer(), this->selected_party_index_, entry.is_shiny, std::string("Male"), &error);
            } else if (opt == 1) {
                changed = puse::core::UpdatePartyIdentity(this->save_session_.MutableBuffer(), this->selected_party_index_, entry.is_shiny, std::string("Female"), &error);
            }
        }
    } else if (section_index == 1) {
        if (field_key == "Item") {
            int item_id = 0;
            if (PromptCatalogChoice("Item", this->items_db_, static_cast<int>(entry.item_id), &item_id)) {
                changed = puse::core::UpdatePartyItem(this->save_session_.MutableBuffer(), this->selected_party_index_, static_cast<uint16_t>(item_id), &error);
            }
        } else if (field_key == "Ability") {
            const int opt = this->CreateShowDialog(
                "Set Ability Slot",
                "Current: Slot " + std::string((entry.current_ability_index == 2) ? "3 (Hidden)" : std::to_string(entry.current_ability_index + 1)),
                {"Slot 1", "Slot 2", "Hidden (Slot 3)"},
                false
            );
            if ((opt >= 0) && (opt <= 2)) {
                changed = puse::core::UpdatePartyAbilitySwitch(this->save_session_.MutableBuffer(), this->selected_party_index_, opt, &error);
            }
        }
    } else if (section_index == 2) {
        // IVs — correct mapping: ivs array is [HP,Atk,Def,Spe,SpA,SpD]
        static const std::array<std::pair<const char *, size_t>, 6> kIvMap = {{
            {"IV HP", 0}, {"IV Atk", 1}, {"IV Def", 2}, {"IV SpA", 4}, {"IV SpD", 5}, {"IV Spe", 3}
        }};
        std::array<uint8_t, 6> ivs = entry.ivs;
        for (const auto &[key, arr_idx] : kIvMap) {
            if (field_key == key) {
                int value = 0;
                if (PromptNumber("Set " + std::string(key), std::to_string(static_cast<int>(ivs[arr_idx])), 0, 31, &value)) {
                    ivs[arr_idx] = static_cast<uint8_t>(value);
                    changed = puse::core::UpdatePartyIvs(this->save_session_.MutableBuffer(), this->selected_party_index_, ivs, &error);
                }
                break;
            }
        }
    } else if (section_index == 3) {
        // EVs — correct mapping: evs array is [HP,Atk,Def,Spe,SpA,SpD]
        static const std::array<std::pair<const char *, size_t>, 6> kEvMap = {{
            {"EV HP", 0}, {"EV Atk", 1}, {"EV Def", 2}, {"EV SpA", 4}, {"EV SpD", 5}, {"EV Spe", 3}
        }};
        std::array<uint8_t, 6> evs = entry.evs;
        for (const auto &[key, arr_idx] : kEvMap) {
            if (field_key == key) {
                int value = 0;
                if (PromptNumber("Set " + std::string(key), std::to_string(static_cast<int>(evs[arr_idx])), 0, 255, &value)) {
                    evs[arr_idx] = static_cast<uint8_t>(value);
                    changed = puse::core::UpdatePartyEvs(this->save_session_.MutableBuffer(), this->selected_party_index_, evs, &error);
                }
                break;
            }
        }
    }

    if (!error.empty()) {
        this->CreateShowDialog("Edit failed", error, {"OK"}, true);
        return;
    }

    if (!changed) {
        return;
    }

    this->dirty_ = true;
    this->UpdateDirtyUi();
    this->party_ = puse::core::ParseParty(this->save_session_.Buffer(), this->species_db_);
    this->RebuildPartyMenu();
    this->RebuildPokemonSectionsMenu();
    this->RebuildPokemonFieldsMenu(section_index);
}

void MainApplication::HandleMoveSlotEdit(const std::string &field_key) {
    if ((this->selected_move_slot_ < 0) || (this->selected_move_slot_ >= 4)) { return; }
    const size_t slot = static_cast<size_t>(this->selected_move_slot_);
    std::string error;
    bool changed = false;

    if (this->edit_context_ == EditContext::Pc) {
        const auto &m = this->selected_pc_mon_;
        auto moves = m.move_ids;
        auto pp_ups = m.move_pp_ups;

        if (field_key == "Move") {
            int move_id = 0;
            if (PromptCatalogChoice("Move", this->moves_db_, static_cast<int>(moves[slot]), &move_id)) {
                moves[slot] = static_cast<uint16_t>(move_id);
                changed = puse::core::UpdatePcMonMoves(this->pc_stream_, this->selected_pc_box_, this->selected_pc_slot_, moves, nullptr, &error);
            }
        } else if (field_key == "PP-Up") {
            int pp_up_value = 0;
            if (PromptNumber("Set PP-Up (0-3)", std::to_string(static_cast<int>(pp_ups[slot])), 0, 3, &pp_up_value)) {
                pp_ups[slot] = static_cast<uint8_t>(pp_up_value);
                changed = puse::core::UpdatePcMonMoves(this->pc_stream_, this->selected_pc_box_, this->selected_pc_slot_, moves, &pp_ups, &error);
            }
        }

        if (!error.empty()) {
            this->CreateShowDialog("Edit failed", error, {"OK"}, true);
            return;
        }
        if (!changed) { return; }

        this->dirty_ = true;
        this->UpdateDirtyUi();
        this->RefreshSelectedPcMon();
        this->RebuildPcBoxMenu();
        this->RebuildMoveListMenu();
        this->RebuildMoveEditMenu();
        return;
    }

    // Party context
    if ((this->selected_party_index_ < 0) || (static_cast<size_t>(this->selected_party_index_) >= this->party_.size())) { return; }
    const auto &entry = this->party_[static_cast<size_t>(this->selected_party_index_)];
    auto moves = entry.move_ids;
    auto move_pp = entry.move_pp;
    auto move_pp_ups = entry.move_pp_ups;

    if (field_key == "Move") {
        int move_id = 0;
        if (PromptCatalogChoice("Move", this->moves_db_, static_cast<int>(moves[slot]), &move_id)) {
            moves[slot] = static_cast<uint16_t>(move_id);
            changed = puse::core::UpdatePartyMoves(this->save_session_.MutableBuffer(), this->selected_party_index_, moves, std::nullopt, std::nullopt, &error);
        }
    } else if (field_key == "PP") {
        const int max_pp = static_cast<int>(entry.move_pp_max[slot]);
        int pp_value = 0;
        if (PromptNumber("Set PP (0-" + std::to_string(max_pp) + ")", std::to_string(static_cast<int>(move_pp[slot])), 0, std::max(0, max_pp), &pp_value)) {
            move_pp[slot] = static_cast<uint8_t>(pp_value);
            changed = puse::core::UpdatePartyMoves(this->save_session_.MutableBuffer(), this->selected_party_index_, moves, move_pp, std::nullopt, &error);
        }
    } else if (field_key == "PP-Up") {
        int pp_up_value = 0;
        if (PromptNumber("Set PP-Up (0-3)", std::to_string(static_cast<int>(move_pp_ups[slot])), 0, 3, &pp_up_value)) {
            move_pp_ups[slot] = static_cast<uint8_t>(pp_up_value);
            changed = puse::core::UpdatePartyMoves(this->save_session_.MutableBuffer(), this->selected_party_index_, moves, std::nullopt, move_pp_ups, &error);
        }
    }

    if (!error.empty()) {
        this->CreateShowDialog("Edit failed", error, {"OK"}, true);
        return;
    }
    if (!changed) { return; }

    this->dirty_ = true;
    this->UpdateDirtyUi();
    this->party_ = puse::core::ParseParty(this->save_session_.Buffer(), this->species_db_);
    this->RebuildPartyMenu();
    this->RebuildPokemonSectionsMenu();
    this->RebuildMoveListMenu();
    this->RebuildMoveEditMenu();
}

void MainApplication::RebuildPartyMenu() {
    const auto menu = this->party_list_layout_->GetMenu();
    menu->ClearItems();

    for (size_t i = 0; i < this->party_.size(); ++i) {
        const auto &entry = this->party_[i];
        std::ostringstream label;
        const std::string display_name = entry.nickname.empty() ? entry.species_name : (entry.nickname + " (" + entry.species_name + ")");
        label << "#" << (entry.index + 1) << "   " << display_name
              << "   Lv " << static_cast<int>(entry.level)
              << "   " << entry.nature_name;
        if (entry.is_shiny) {
            label << "   [Shiny]";
        }
        if (entry.item_id != 0) {
            const std::string item_name = GetDbName(this->items_db_, entry.item_id);
            label << "   @" << TruncateText(item_name, 18);
        }

        auto item = pu::ui::elm::MenuItem::New(label.str());
        item->SetColor({255, 255, 255, 255});
        item->SetIcon(GetPokemonIcon(entry.species_id));

        const int idx = static_cast<int>(i);
        item->AddOnKey([this, idx]() {
            this->party_list_layout_->GetMenu()->SetSelectedIndex(static_cast<u32>(idx));
            this->selected_party_index_ = idx;
            this->OpenSelectedPartyPage();
        }, HidNpadButton_A);

        menu->AddItem(item);
    }

    menu->ForceReloadItems();
    if (!this->party_.empty()) {
        menu->SetSelectedIndex(0);
    }
}

void MainApplication::RebuildPokemonSectionsMenu() {
    const auto menu = this->pokemon_sections_layout_->GetMenu();
    menu->ClearItems();

    static const std::vector<std::string> sections = {
        "Summary",
        "Battle",
        "IVs",
        "EVs",
        "Moves",
    };

    for (size_t i = 0; i < sections.size(); ++i) {
        auto item = pu::ui::elm::MenuItem::New(sections[i]);
        item->SetColor({255, 255, 255, 255});
        const int section_index = static_cast<int>(i);
        item->AddOnKey([this, section_index]() {
            this->OpenSelectedSectionPage(section_index);
        }, HidNpadButton_A);
        menu->AddItem(item);
    }

    menu->ForceReloadItems();
    menu->SetSelectedIndex(0);
}

void MainApplication::RebuildPokemonFieldsMenu(const int section_index) {
    if ((this->selected_party_index_ < 0) || (static_cast<size_t>(this->selected_party_index_) >= this->party_.size())) {
        return;
    }

    const auto &entry = this->party_[static_cast<size_t>(this->selected_party_index_)];
    const auto menu = this->pokemon_fields_layout_->GetMenu();
    menu->ClearItems();

    std::vector<std::pair<std::string, std::string>> rows;
    std::string section_title;

    // Stat display order: HP, Atk, Def, SpA, SpD, Spe (ivs/evs array: [HP,Atk,Def,Spe,SpA,SpD])
    static const std::array<std::pair<const char *, size_t>, 6> kStatOrder = {{
        {"HP", 0}, {"Atk", 1}, {"Def", 2}, {"SpA", 4}, {"SpD", 5}, {"Spe", 3}
    }};

    if (section_index == 0) {
        section_title = "Summary";
        rows.push_back({"Species", entry.species_name});
        rows.push_back({"Nickname", entry.nickname.empty() ? "-" : entry.nickname});
        rows.push_back({"Level", std::to_string(static_cast<int>(entry.level))});
        rows.push_back({"Nature", entry.nature_name});
        rows.push_back({"Shiny", entry.is_shiny ? "Yes" : "No"});
        if (entry.gender_editable) {
            rows.push_back({"Gender", entry.gender});
        }
    } else if (section_index == 1) {
        section_title = "Battle";
        const std::string slot_str = (entry.current_ability_index == 2) ? "3 (Hidden)" : std::to_string(entry.current_ability_index + 1);
        const std::string ability_str = entry.ability_label_current.empty()
            ? (entry.hidden_ability ? "Hidden" : "Standard")
            : entry.ability_label_current;
        rows.push_back({"Item", GetDbName(this->items_db_, entry.item_id)});
        rows.push_back({"Ability", ability_str + "   Slot " + slot_str});
        rows.push_back({"PID", std::to_string(entry.pid)});
        rows.push_back({"OTID", std::to_string(entry.otid)});
    } else if (section_index == 2) {
        section_title = "IVs";
        for (const auto &[stat, idx] : kStatOrder) {
            rows.push_back({"IV " + std::string(stat), std::to_string(static_cast<int>(entry.ivs[idx]))});
        }
    } else if (section_index == 3) {
        section_title = "EVs";
        int ev_total = 0;
        for (const auto &[stat, idx] : kStatOrder) {
            ev_total += entry.evs[idx];
        }
        for (const auto &[stat, idx] : kStatOrder) {
            rows.push_back({"EV " + std::string(stat), std::to_string(static_cast<int>(entry.evs[idx]))});
        }
        // Show EV total in subtitle
        this->pokemon_fields_layout_->SetSectionHeader(
            entry.nickname.empty() ? entry.species_name : entry.nickname,
            "EVs   [" + std::to_string(ev_total) + "/510]"
        );
        // Skip the standard SetSectionHeader call below
        for (const auto &row : rows) {
            const std::string value = TruncateText(row.second, 36);
            auto item = pu::ui::elm::MenuItem::New(row.first + "   " + value);
            item->SetColor({255, 255, 255, 255});
            item->AddOnKey([this, row, section_index]() {
                this->HandleFieldEdit(section_index, row.first);
            }, HidNpadButton_A);
            menu->AddItem(item);
        }
        menu->ForceReloadItems();
        if (!rows.empty()) {
            menu->SetSelectedIndex(0);
        }
        return;
    }

    this->pokemon_fields_layout_->SetSectionHeader(entry.nickname.empty() ? entry.species_name : entry.nickname, section_title);

    for (const auto &row : rows) {
        const std::string value = TruncateText(row.second, 36);
        auto item = pu::ui::elm::MenuItem::New(row.first + "   " + value);
        item->SetColor({255, 255, 255, 255});
        if ((section_index == 1) && (row.first == "Item")) {
            item->SetIcon(GetItemIcon(entry.item_id));
        }
        item->AddOnKey([this, row, section_index]() {
            this->HandleFieldEdit(section_index, row.first);
        }, HidNpadButton_A);
        menu->AddItem(item);
    }

    menu->ForceReloadItems();
    if (!rows.empty()) {
        menu->SetSelectedIndex(0);
    }
}

void MainApplication::OpenSelectedPartyPage() {
    if ((this->selected_party_index_ < 0) || (static_cast<size_t>(this->selected_party_index_) >= this->party_.size())) {
        return;
    }

    this->edit_context_ = EditContext::Party;
    const auto &entry = this->party_[static_cast<size_t>(this->selected_party_index_)];
    this->pokemon_sections_layout_->SetPokemonHeader(entry, GetPokemonIcon(entry.species_id), this->dirty_);
    this->RebuildPokemonSectionsMenu();
    this->ShowLayoutScreen(this->pokemon_sections_layout_);
}

void MainApplication::OpenSelectedSectionPage(const int section_index) {
    if (section_index == 4) {
        this->RebuildMoveListMenu();
        this->ShowLayoutScreen(this->pokemon_move_list_layout_);
    } else if (this->edit_context_ == EditContext::Pc) {
        this->RebuildPcFieldsMenu(section_index);
        this->ShowLayoutScreen(this->pokemon_fields_layout_);
    } else {
        this->RebuildPokemonFieldsMenu(section_index);
        this->ShowLayoutScreen(this->pokemon_fields_layout_);
    }
}

void MainApplication::OpenMoveSlotPage(const int slot) {
    this->selected_move_slot_ = slot;
    this->RebuildMoveEditMenu();
    this->ShowLayoutScreen(this->pokemon_move_edit_layout_);
}

void MainApplication::RebuildMoveListMenu() {
    const auto menu = this->pokemon_move_list_layout_->GetMenu();
    menu->ClearItems();

    std::array<uint16_t, 4> move_ids{};
    std::array<uint8_t, 4> move_pp{};
    std::array<uint8_t, 4> move_pp_max{};
    std::array<uint8_t, 4> move_pp_ups{};
    std::string subtitle;

    if (this->edit_context_ == EditContext::Pc) {
        const auto &m = this->selected_pc_mon_;
        subtitle = m.nickname.empty() ? m.species_name : m.nickname;
        move_ids = m.move_ids;
        move_pp_ups = m.move_pp_ups;
        move_pp_max = m.move_pp_max;
        move_pp = m.move_pp_max;  // PC has no current PP, show max
    } else {
        if ((this->selected_party_index_ < 0) || (static_cast<size_t>(this->selected_party_index_) >= this->party_.size())) {
            return;
        }
        const auto &entry = this->party_[static_cast<size_t>(this->selected_party_index_)];
        subtitle = entry.nickname.empty() ? entry.species_name : entry.nickname;
        move_ids = entry.move_ids;
        move_pp = entry.move_pp;
        move_pp_max = entry.move_pp_max;
        move_pp_ups = entry.move_pp_ups;
    }

    this->pokemon_move_list_layout_->SetSubtitle(subtitle);

    for (size_t i = 0; i < 4; ++i) {
        const std::string move_name = GetDbName(this->moves_db_, move_ids[i]);
        const std::string pp_str = std::to_string(static_cast<int>(move_pp[i]))
            + "/" + std::to_string(static_cast<int>(move_pp_max[i]));
        std::ostringstream label;
        label << (i + 1) << ".   " << TruncateText(move_name, 24) << "   PP " << pp_str;
        if (move_pp_ups[i] > 0) {
            label << "   [+" << static_cast<int>(move_pp_ups[i]) << " PP-Up]";
        }

        auto item = pu::ui::elm::MenuItem::New(label.str());
        item->SetColor({255, 255, 255, 255});
        const int slot = static_cast<int>(i);
        item->AddOnKey([this, slot]() {
            this->OpenMoveSlotPage(slot);
        }, HidNpadButton_A);
        menu->AddItem(item);
    }

    menu->ForceReloadItems();
    menu->SetSelectedIndex(0);
}

void MainApplication::RebuildMoveEditMenu() {
    if ((this->selected_move_slot_ < 0) || (this->selected_move_slot_ >= 4)) { return; }
    const auto menu = this->pokemon_move_edit_layout_->GetMenu();
    menu->ClearItems();

    const size_t slot = static_cast<size_t>(this->selected_move_slot_);
    std::string pokemon_name;
    std::string move_name;
    std::string pp_str;
    std::string pp_up_str;

    if (this->edit_context_ == EditContext::Pc) {
        const auto &m = this->selected_pc_mon_;
        pokemon_name = m.nickname.empty() ? m.species_name : m.nickname;
        move_name = GetDbName(this->moves_db_, m.move_ids[slot]);
        pp_str = std::to_string(static_cast<int>(m.move_pp_max[slot])) + " / "
            + std::to_string(static_cast<int>(m.move_pp_max[slot])) + "  [max]";
        pp_up_str = std::to_string(static_cast<int>(m.move_pp_ups[slot])) + " / 3";
    } else {
        if ((this->selected_party_index_ < 0) || (static_cast<size_t>(this->selected_party_index_) >= this->party_.size())) { return; }
        const auto &entry = this->party_[static_cast<size_t>(this->selected_party_index_)];
        pokemon_name = entry.nickname.empty() ? entry.species_name : entry.nickname;
        move_name = GetDbName(this->moves_db_, entry.move_ids[slot]);
        pp_str = std::to_string(static_cast<int>(entry.move_pp[slot]))
            + " / " + std::to_string(static_cast<int>(entry.move_pp_max[slot]));
        pp_up_str = std::to_string(static_cast<int>(entry.move_pp_ups[slot])) + " / 3";
    }

    this->pokemon_move_edit_layout_->SetMoveSlotHeader(pokemon_name, this->selected_move_slot_);

    std::vector<std::pair<std::string, std::string>> rows = {
        {"Move",   TruncateText(move_name, 28)},
        {"PP",     pp_str},
        {"PP-Up",  pp_up_str},
    };

    for (const auto &row : rows) {
        auto item = pu::ui::elm::MenuItem::New(row.first + "   " + row.second);
        item->SetColor({255, 255, 255, 255});
        // PC mons: PP is read-only (derived from base PP + PP-Up).
        const bool editable = (this->edit_context_ != EditContext::Pc) || (row.first != "PP");
        if (editable) {
            item->AddOnKey([this, row]() {
                this->HandleMoveSlotEdit(row.first);
            }, HidNpadButton_A);
        } else {
            item->AddOnKey([this]() {
                this->CreateShowDialog("PP (PC)", "PP is derived from base PP + PP-Up.\nEdit PP-Up to change it.", {"OK"}, true);
            }, HidNpadButton_A);
        }
        menu->AddItem(item);
    }

    menu->ForceReloadItems();
    menu->SetSelectedIndex(0);
}

void MainApplication::ShowSaveToast(const std::string &msg) {
    this->save_toast_->SetText(msg);
    this->StartOverlayWithTimeout(this->save_toast_, 2000);
}

void MainApplication::ShowLayoutScreen(pu::ui::Layout::Ref layout) {
    this->layout_stack_.push_back(layout);
    this->LoadLayout(layout);
}

bool MainApplication::PopLayoutScreen() {
    if (this->layout_stack_.size() <= 1) {
        return false;
    }

    this->layout_stack_.pop_back();
    this->LoadLayout(this->layout_stack_.back());
    return true;
}

void MainApplication::OnLoad() {
    this->ConfigureTheme();
    this->selected_party_index_ = -1;
    this->selected_move_slot_ = -1;
    this->selected_pc_box_ = 1;
    this->selected_pc_slot_ = 1;
    this->pc_stream_loaded_ = false;
    this->dirty_ = false;
    this->edit_context_ = EditContext::Party;
    this->item_index_ready_ = false;
    this->pokemon_icon_cache_.clear();
    this->item_icon_cache_.clear();
    this->item_norm_to_path_.clear();
    this->item_token_index_.clear();

    this->app_icon_ = LoadTextureHandle(io::ResolveAssetPath("icons/items/Base Items/poke-ball.png"));
    this->home_layout_               = HomeLayout::New(this->theme_, this->app_icon_);
    this->party_list_layout_         = PartyListLayout::New(this->theme_, this->app_icon_);
    this->pokemon_sections_layout_   = PokemonSectionsLayout::New(this->theme_, this->app_icon_);
    this->pokemon_fields_layout_     = PokemonFieldsLayout::New(this->theme_, this->app_icon_);
    this->pokemon_move_list_layout_  = PokemonMoveListLayout::New(this->theme_, this->app_icon_);
    this->pokemon_move_edit_layout_  = PokemonMoveEditLayout::New(this->theme_, this->app_icon_);
    this->diagnostics_layout_        = DiagnosticsLayout::New(this->theme_, this->app_icon_);
    this->money_edit_layout_         = MoneyEditLayout::New(this->theme_, this->app_icon_);
    this->pc_box_list_layout_        = PcBoxListLayout::New(this->theme_, this->app_icon_);
    this->pc_box_layout_             = PcBoxLayout::New(this->theme_, this->app_icon_);

    this->toast_text_ = pu::ui::elm::TextBlock::New(0, 0, "");
    this->toast_text_->SetColor(this->theme_.text_primary);
    this->toast_text_->SetFont(pu::ui::GetDefaultFont(pu::ui::DefaultFontSize::Medium));
    this->save_toast_ = pu::ui::extras::Toast::New(this->toast_text_, pu::ui::Color(40, 52, 72, 0xE8));

    this->SetOnInput([&](const u64 down, const u64, const u64, const pu::ui::TouchPoint) {
        if (down & HidNpadButton_X) {
            if (!this->dirty_) {
                this->ShowSaveToast("No pending changes");
            } else {
                std::string save_error;
                if (this->SaveCurrentSession(&save_error)) {
                    this->ShowSaveToast("Saved to Unbound.sav");
                } else {
                    this->CreateShowDialog("Save failed", save_error.empty() ? "Unknown save error" : save_error, {"OK"}, true);
                }
            }
        }
        if (down & HidNpadButton_Plus) {
            this->Close();
        }
        if (down & HidNpadButton_B) {
            this->PopLayoutScreen();
        }
    });

    std::string error;
    const bool ok = this->RefreshPartyData(&error);
    if (!ok) {
        this->diagnostics_layout_->SetSubtitle("Failed to load save");
        this->diagnostics_layout_->SetLines({"Unable to boot.", error, "Expected: sdmc:/switch/puse/Unbound.sav"});
        this->ShowLayoutScreen(this->diagnostics_layout_);
        return;
    }

    // Load PC stream (non-fatal if it fails).
    this->pc_stream_loaded_ = this->LoadPcStream(nullptr);

    if (this->party_.empty()) {
        this->party_list_layout_->SetSubtitle("Party is empty");
    } else {
        this->party_list_layout_->SetSubtitle("Loaded " + std::to_string(this->party_.size()) + " slot(s)");
        this->RebuildPartyMenu();
    }

    this->UpdateDirtyUi();
    this->RebuildHomeMenu();
    this->ShowLayoutScreen(this->home_layout_);
}

} // namespace puse::ui

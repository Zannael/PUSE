#pragma once

#include <memory>
#include <vector>
#include <unordered_map>
#include <string>
#include <functional>

#include "ui/BaseScreen.h"
#include "starlight/ui/ScrollField.h"
#include "starlight/ui/Button.h"
#include "starlight/ui/Label.h"
#include <puse/core/Party.hpp>

namespace puse::ui {

class PokemonFieldsScreen : public BaseScreen {
public:
    enum class Section { Summary = 0, Battle = 1, Training = 2, Moves = 3 };

    static std::shared_ptr<PokemonFieldsScreen> Make(int slot, Section section);
    PokemonFieldsScreen(int slot, Section section);
    void Update(bool focused) override;

private:
    int slot_;
    Section section_;
    puse::core::PartyEntry entry_;

    std::shared_ptr<sl::ui::ScrollField> scroll_;
    std::vector<std::shared_ptr<sl::ui::Button>> field_btns_;
    std::shared_ptr<sl::ui::Label> preview_label_;

    void LoadEntry();
    void RefreshPreview();
    void BuildSummaryFields();
    void BuildBattleFields();
    void BuildTrainingFields();
    void BuildMovesFields();
    void RefreshFields();
    void CommitAndRefresh();

    // Add one full-width field button at canvas y; push to field_btns_
    std::shared_ptr<sl::ui::Button> AddField(int y);

    std::string NameOrId(const std::unordered_map<int, std::string>& db, int id) const;
};

} // namespace puse::ui

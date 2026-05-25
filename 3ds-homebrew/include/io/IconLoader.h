#pragma once
#include <string>
#include <cstdint>

namespace puse::io {

// Returns the first existing icon file path for the given species, or "" if none found.
// Search roots: romfs:/icons/pokemon, sdmc:/3ds/puse/icons/pokemon
// Filename tries: {id:04d}.png, gFrontSprite{id:03d}.png (prefix), {id:03d}.png
std::string ResolveMonIconPath(uint16_t species_id);

// Same for item icons.
std::string ResolveItemIconPath(uint16_t item_id);

} // namespace puse::io

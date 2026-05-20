#pragma once

#include <string>
#include <unordered_map>

namespace puse::io {

std::string ResolveAssetPath(const std::string &relative_path);
std::unordered_map<int, std::string> LoadIdNameFile(const std::string &path);

} // namespace puse::io

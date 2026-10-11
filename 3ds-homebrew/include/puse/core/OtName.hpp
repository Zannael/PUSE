#pragma once
#include <string>

namespace puse::core {
// Matches backend/core/ot_name.py. Validate before touching save bytes.
inline bool ValidateOtName(const std::string &value, std::string *name, std::string *error) {
    const auto first = value.find_first_not_of(" \t\r\n");
    const auto last = value.find_last_not_of(" \t\r\n");
    *name = first == std::string::npos ? "" : value.substr(first, last - first + 1);
    if (name->empty() || name->size() > 7) {
        if (error) *error = "Original Trainer name must contain 1 to 7 characters";
        return false;
    }
    if (name->find_first_not_of("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 !?.-'") != std::string::npos) {
        if (error) *error = "Original Trainer name supports letters, numbers, spaces and ! ? . - '";
        return false;
    }
    return true;
}
} // namespace puse::core

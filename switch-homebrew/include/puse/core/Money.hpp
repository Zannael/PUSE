#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace puse::core {

constexpr uint32_t kMaxMoney = 999999999U;

bool ReadMoney(const std::vector<uint8_t> &buffer, uint32_t *out_money, std::string *error = nullptr);
bool WriteMoney(std::vector<uint8_t> &buffer, uint32_t money, std::string *error = nullptr);

} // namespace puse::core

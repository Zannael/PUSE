#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace puse::core {

constexpr uint32_t kMaxMoney = 999999999U;
constexpr uint16_t kMaxBp = 65535U;

bool ReadMoney(const std::vector<uint8_t> &buffer, uint32_t *out_money, std::string *error = nullptr);
bool WriteMoney(std::vector<uint8_t> &buffer, uint32_t money, std::string *error = nullptr);

// Battle Points: section ID 4, offset 0xF34, u16 LE, no checksum update (opaque section).
bool ReadBp(const std::vector<uint8_t> &buffer, uint16_t *out_bp, std::string *error = nullptr);
bool WriteBp(std::vector<uint8_t> &buffer, uint16_t bp, std::string *error = nullptr);

} // namespace puse::core

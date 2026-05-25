#pragma once

#include <cstddef>
#include <cstdint>

namespace puse::core {

inline uint16_t ReadU16Le(const uint8_t *buf, const size_t off) {
    return static_cast<uint16_t>(buf[off]) |
           (static_cast<uint16_t>(buf[off + 1]) << 8U);
}

inline uint32_t ReadU32Le(const uint8_t *buf, const size_t off) {
    return static_cast<uint32_t>(buf[off]) |
           (static_cast<uint32_t>(buf[off + 1]) << 8U) |
           (static_cast<uint32_t>(buf[off + 2]) << 16U) |
           (static_cast<uint32_t>(buf[off + 3]) << 24U);
}

inline void WriteU16Le(uint8_t *buf, const size_t off, const uint16_t value) {
    buf[off] = static_cast<uint8_t>(value & 0xFFU);
    buf[off + 1] = static_cast<uint8_t>((value >> 8U) & 0xFFU);
}

inline void WriteU32Le(uint8_t *buf, const size_t off, const uint32_t value) {
    buf[off] = static_cast<uint8_t>(value & 0xFFU);
    buf[off + 1] = static_cast<uint8_t>((value >> 8U) & 0xFFU);
    buf[off + 2] = static_cast<uint8_t>((value >> 16U) & 0xFFU);
    buf[off + 3] = static_cast<uint8_t>((value >> 24U) & 0xFFU);
}

} // namespace puse::core

#include <puse/core/Money.hpp>

#include <puse/core/Binary.hpp>
#include <puse/core/SaveSections.hpp>

namespace puse::core {

namespace {

constexpr uint16_t kTrainerSectionId = 1;
constexpr size_t kMoneyU32Off = 0x290;
constexpr size_t kMoneyBcdOff = 0x28D;
constexpr uint32_t kMaxBcdMoney = 999999U;

// Python to_bcd3: b0=(s[1]<<4)|s[0], b1=(s[3]<<4)|s[2], b2=(s[5]<<4)|s[4]
// s[0..5] are most-significant to least-significant decimal digits.
// d0=units...d5=hundred-thousands. So s[0]=d5, s[1]=d4, etc.
// b0 = (d4<<4)|d5, b1 = (d2<<4)|d3, b2 = (d0<<4)|d1
void WriteBcd3(uint8_t *buf, const size_t off, const uint32_t value) {
    const uint32_t v = (value > kMaxBcdMoney) ? kMaxBcdMoney : value;
    const uint8_t d0 = static_cast<uint8_t>(v % 10U);
    const uint8_t d1 = static_cast<uint8_t>((v / 10U) % 10U);
    const uint8_t d2 = static_cast<uint8_t>((v / 100U) % 10U);
    const uint8_t d3 = static_cast<uint8_t>((v / 1000U) % 10U);
    const uint8_t d4 = static_cast<uint8_t>((v / 10000U) % 10U);
    const uint8_t d5 = static_cast<uint8_t>((v / 100000U) % 10U);
    buf[off + 0] = static_cast<uint8_t>((d4 << 4U) | d5);
    buf[off + 1] = static_cast<uint8_t>((d2 << 4U) | d3);
    buf[off + 2] = static_cast<uint8_t>((d0 << 4U) | d1);
}

} // namespace

bool ReadMoney(const std::vector<uint8_t> &buffer, uint32_t *out_money, std::string *error) {
    const auto sections = ListSections(buffer);

    const SaveSection *best = nullptr;
    for (const auto &s : sections) {
        if (s.section_id != kTrainerSectionId) {
            continue;
        }
        if ((best == nullptr) || (s.save_index > best->save_index)) {
            best = &s;
        }
    }

    if (best == nullptr) {
        if (error != nullptr) {
            *error = "trainer section not found";
        }
        return false;
    }

    const size_t abs_off = best->offset + kMoneyU32Off;
    if ((abs_off + 4U) > buffer.size()) {
        if (error != nullptr) {
            *error = "money offset out of bounds";
        }
        return false;
    }

    *out_money = ReadU32Le(buffer.data() + best->offset, kMoneyU32Off);
    return true;
}

bool WriteMoney(std::vector<uint8_t> &buffer, const uint32_t money, std::string *error) {
    const uint32_t clamped = (money > kMaxMoney) ? kMaxMoney : money;
    const auto sections = ListSections(buffer);
    bool any = false;

    for (const auto &s : sections) {
        if (s.section_id != kTrainerSectionId) {
            continue;
        }
        any = true;

        const size_t u32_abs = s.offset + kMoneyU32Off;
        if ((u32_abs + 4U) <= buffer.size()) {
            WriteU32Le(buffer.data() + s.offset, kMoneyU32Off, clamped);
        }

        const size_t bcd_abs = s.offset + kMoneyBcdOff;
        if ((bcd_abs + 3U) <= buffer.size()) {
            WriteBcd3(buffer.data() + s.offset, kMoneyBcdOff, clamped);
        }

        const uint16_t new_chk = ComputeSectionChecksumForSection(buffer, s);
        WriteU16Le(buffer.data() + s.offset, kFooterChecksumOffset, new_chk);
    }

    if (!any) {
        if (error != nullptr) {
            *error = "no trainer section found";
        }
        return false;
    }
    return true;
}

} // namespace puse::core

#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace puse::core {

enum class TransferMode {
    PartyToPc,
    PcToParty,
    SwapPartyPc,
};

struct TransferRequest {
    TransferMode mode = TransferMode::PartyToPc;
    int party_index = -1;
    int box = 0;   // 1-based ordinary box; 0 = auto first empty (party_to_pc only)
    int slot = 0;  // 1-based slot; 0 = auto first empty (party_to_pc only)
};

struct TransferResult {
    TransferMode mode = TransferMode::PartyToPc;
    int party_index = -1;
    int box = 0;
    int slot = 0;
    int party_count = 0;
};

bool PartyRawToPcRaw(
    const uint8_t *party_raw,
    size_t party_len,
    std::array<uint8_t, 58> *out_pc,
    std::string *error = nullptr
);

bool PcRawToPartyRaw(
    const uint8_t *pc_raw,
    size_t pc_len,
    std::array<uint8_t, 100> *out_party,
    std::string *error = nullptr
);

bool FindFirstEmptyPcSlot(
    const std::vector<uint8_t> &stream,
    int box_filter,
    int *out_box,
    int *out_slot,
    std::string *error = nullptr
);

bool TransferPartyPc(
    std::vector<uint8_t> &buffer,
    const TransferRequest &req,
    TransferResult *out = nullptr,
    std::string *error = nullptr
);

} // namespace puse::core

// Cross-runtime Party/PC Transfer host harness: compiled against each port's real core.
#include <puse/core/GameProfile.hpp>
#include <puse/core/Party.hpp>
#include <puse/core/Pc.hpp>
#include <puse/core/SaveSession.hpp>
#include <puse/core/Transfer.hpp>

#include <cassert>
#include <cstdint>
#include <fstream>
#include <string>
#include <vector>

namespace {

void WriteFile(const std::string& path, const std::vector<uint8_t>& bytes) {
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    out.write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
    assert(out.good());
}

std::string FormatLabel(const puse::core::TransferResult& res) {
    const int p_num = res.party_index + 1;
    if (res.mode == puse::core::TransferMode::PartyToPc) {
        return "Move Party #" + std::to_string(p_num) + " -> Box " + std::to_string(res.box) + "-" + std::to_string(res.slot);
    }
    if (res.mode == puse::core::TransferMode::PcToParty) {
        return "Move Box " + std::to_string(res.box) + "-" + std::to_string(res.slot) + " -> Party #" + std::to_string(p_num);
    }
    return "Swap Party #" + std::to_string(p_num) + " <-> Box " + std::to_string(res.box) + "-" + std::to_string(res.slot);
}

void RunTransferAndRecord(
    puse::core::SaveSession& session,
    const puse::core::TransferRequest& req,
    puse::core::TransferResult* out_res = nullptr
) {
    const auto before = session.Buffer();
    puse::core::TransferResult res{};
    std::string err;
    assert(puse::core::TransferPartyPc(session.MutableBuffer(), req, &res, &err));
    assert(session.RecordMutation(before, "party_pc_transfer", FormatLabel(res)));
    if (out_res) *out_res = res;
}

void AssertRejectsImmutable(
    const std::vector<uint8_t>& base_buf,
    const puse::core::TransferRequest& req
) {
    std::vector<uint8_t> copy = base_buf;
    std::string err;
    puse::core::TransferResult res{};
    const bool ok = puse::core::TransferPartyPc(copy, req, &res, &err);
    assert(!ok);
    assert(!err.empty());
    assert(copy == base_buf);
}

} // namespace

int main(int argc, char** argv) {
    using namespace puse::core;
    // Args: <main_in.sav> <one_mon_in.sav> <full_pc_in.sav> <out_prefix> <profile_id>
    assert(argc == 6);
    const std::string main_in_path = argv[1];
    const std::string one_in_path = argv[2];
    const std::string full_pc_in_path = argv[3];
    const std::string out_prefix = argv[4];
    const std::string profile_id = argv[5];

    const bool is_unbound = (profile_id == "unbound-2.1.1.1");
    const int boundary_box = is_unbound ? 20 : 25;
    const int boundary_slot = is_unbound ? 1 : 5;
    const int swap_box = is_unbound ? 23 : 25;
    const int swap_slot = is_unbound ? 4 : 1;
    const int box_count = is_unbound ? 24 : 25;

    std::string error;
    SaveSession session;
    assert(session.LoadFromFile(main_in_path, &error, profile_id));
    assert(EnsurePartyStaticDataLoaded(&error));
    const std::vector<uint8_t> original = session.OriginalBuffer();

    // s1: Party index 0 -> boundary empty slot (tests compaction from index 0)
    TransferResult res{};
    RunTransferAndRecord(session, {TransferMode::PartyToPc, 0, boundary_box, boundary_slot}, &res);
    assert(res.party_count == 5);
    WriteFile(out_prefix + "-s1.sav", session.Buffer());

    // s2: Party index 1 -> auto first empty slot (must skip Box 1-1 valid & Box 1-2 unknown -> pick Box 1-3)
    RunTransferAndRecord(session, {TransferMode::PartyToPc, 1, 0, 0}, &res);
    assert(res.box == 1 && res.slot == 3 && res.party_count == 4);
    WriteFile(out_prefix + "-s2.sav", session.Buffer());

    // s3: PC Box 1 slot 1 -> Party (appended at index 4)
    RunTransferAndRecord(session, {TransferMode::PcToParty, -1, 1, 1}, &res);
    assert(res.party_index == 4 && res.party_count == 5);
    WriteFile(out_prefix + "-s3.sav", session.Buffer());

    // s4: Swap Party index 2 <-> swap_box/swap_slot
    RunTransferAndRecord(session, {TransferMode::SwapPartyPc, 2, swap_box, swap_slot}, &res);
    assert(res.party_count == 5);
    WriteFile(out_prefix + "-s4.sav", session.Buffer());

    // s5: Round-trip Party index 4 -> Box 1-1 -> Party index 4
    RunTransferAndRecord(session, {TransferMode::PartyToPc, 4, 1, 1}, &res);
    assert(res.party_count == 4);
    RunTransferAndRecord(session, {TransferMode::PcToParty, -1, 1, 1}, &res);
    assert(res.party_index == 4 && res.party_count == 5);
    WriteFile(out_prefix + "-s5.sav", session.Buffer());

    // Rejections on main fixture state (all must leave bytes identical):
    AssertRejectsImmutable(session.Buffer(), {TransferMode::PartyToPc, 0, 1, 3});        // occupied valid slot
    AssertRejectsImmutable(session.Buffer(), {TransferMode::PartyToPc, 0, 1, 2});        // unknown species reserved slot
    AssertRejectsImmutable(session.Buffer(), {TransferMode::PcToParty, -1, 1, 1});       // empty slot
    AssertRejectsImmutable(session.Buffer(), {TransferMode::PcToParty, -1, 1, 2});       // unknown species slot
    AssertRejectsImmutable(session.Buffer(), {TransferMode::SwapPartyPc, 0, 1, 1});      // swap with empty slot
    AssertRejectsImmutable(session.Buffer(), {TransferMode::SwapPartyPc, 0, 1, 2});      // swap with unknown slot
    AssertRejectsImmutable(session.Buffer(), {TransferMode::PartyToPc, 0, 26, 1});       // Preset Box 26 rejected
    AssertRejectsImmutable(session.Buffer(), {TransferMode::PcToParty, -1, 26, 1});      // Preset Box 26 rejected
    AssertRejectsImmutable(session.Buffer(), {TransferMode::PartyToPc, 0, box_count + 1, 1});
    AssertRejectsImmutable(session.Buffer(), {TransferMode::PartyToPc, 0, 1, 31});
    AssertRejectsImmutable(session.Buffer(), {TransferMode::PartyToPc, 5, 1, 1});        // party_index == party_count
    AssertRejectsImmutable(original, {TransferMode::PcToParty, -1, 1, 3});               // party_count == 6 full

    // Undo back to s4 (2 pops because s5 was 2 steps) then all the way to original
    LedgerEntrySummary undone{};
    assert(session.UndoLastChange(&undone, &error));
    assert(session.UndoLastChange(&undone, &error));
    WriteFile(out_prefix + "-undo_to_s4.sav", session.Buffer());
    while (session.CanUndo()) {
        assert(session.UndoLastChange(&undone, &error));
    }
    assert(session.Buffer() == original);
    WriteFile(out_prefix + "-undo_all.sav", session.Buffer());

    // Re-mutate and test ResetToOriginal
    RunTransferAndRecord(session, {TransferMode::SwapPartyPc, 0, 1, 1}, &res);
    assert(session.Buffer() != original);
    session.ResetToOriginal();
    assert(session.Buffer() == original);
    WriteFile(out_prefix + "-reset.sav", session.Buffer());

    // Single-mon party fixture: reject party_to_pc, allow swap_party_pc
    {
        SaveSession one_session;
        assert(one_session.LoadFromFile(one_in_path, &error, profile_id));
        AssertRejectsImmutable(one_session.Buffer(), {TransferMode::PartyToPc, 0, 1, 3});
        AssertRejectsImmutable(one_session.Buffer(), {TransferMode::PartyToPc, 0, 0, 0});
        RunTransferAndRecord(one_session, {TransferMode::SwapPartyPc, 0, 1, 1}, &res);
        assert(res.party_count == 1);
        WriteFile(out_prefix + "-one_swap.sav", one_session.Buffer());
    }

    // Full PC fixture: reject auto party_to_pc with zero byte changes
    {
        SaveSession full_session;
        assert(full_session.LoadFromFile(full_pc_in_path, &error, profile_id));
        AssertRejectsImmutable(full_session.Buffer(), {TransferMode::PartyToPc, 0, 0, 0});
        AssertRejectsImmutable(full_session.Buffer(), {TransferMode::PartyToPc, 0, 1, 0});
    }

    return 0;
}

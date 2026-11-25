// Cross-runtime ChangeLedger host harness: compile against each port's real core.
#include <puse/core/Bag.hpp>
#include <puse/core/ChangeLedger.hpp>
#include <puse/core/Money.hpp>
#include <puse/core/Party.hpp>
#include <puse/core/Pc.hpp>
#include <puse/core/SaveSession.hpp>

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

} // namespace

int main(int argc, char** argv) {
    using namespace puse::core;
    // Args: <in.sav> <out_prefix> <profile_id> <bag_offset>
    assert(argc == 5);
    const std::string in_path = argv[1];
    const std::string out_prefix = argv[2];
    const std::string profile_id = argv[3];
    const uint32_t bag_offset = static_cast<uint32_t>(std::stoul(argv[4]));
    const bool is_unbound = (profile_id == "unbound-2.1.1.1");

    std::string error;
    assert(EnsurePartyStaticDataLoaded(&error));
    if (is_unbound) {
        assert(EnsureBagDataLoaded(&error));
    }

    SaveSession session;
    assert(session.LoadFromFile(in_path, &error, profile_id));
    const std::vector<uint8_t> original = session.OriginalBuffer();
    std::vector<uint8_t> stream = BuildPcStream(session.Buffer(), &error);
    assert(!stream.empty());

    // Step 1: Party happiness mutation
    {
        const auto before = session.Buffer();
        assert(UpdatePartyHappiness(session.MutableBuffer(), 0, 200, &error));
        assert(CommitPartySectionChecksums(session.MutableBuffer(), &error));
        assert(session.RecordMutation(before, "party_edit", "Edit Party slot 1"));
    }
    WriteFile(out_prefix + "-step1.sav", session.Buffer());

    // Step 2: PC slot 1 item mutation + immediate commit
    {
        const auto before = session.Buffer();
        assert(UpdatePcMonItem(stream, 1, 1, 17, &error));
        assert(CommitPcStream(session.MutableBuffer(), stream, &error));
        assert(session.RecordMutation(before, "pc_edit", "Edit Box 1 slot 1 item"));
    }
    WriteFile(out_prefix + "-step2.sav", session.Buffer());

    // Step 3a: Aborted group must leave buffer and history unchanged
    const size_t entries_before_abort = session.History().entries.size();
    assert(session.BeginHistoryGroup("resources_edit", "Aborted group", &error));
    assert(WriteMoney(session.MutableBuffer(), 777777, &error));
    assert(session.AbortHistoryGroup());
    assert(session.History().entries.size() == entries_before_abort);
    WriteFile(out_prefix + "-aborted.sav", session.Buffer());

    // Step 3b: Committed group (Money, plus BP on Unbound)
    assert(session.BeginHistoryGroup("resources_edit", "Update Money / BP", &error));
    assert(WriteMoney(session.MutableBuffer(), 88888, &error));
    if (is_unbound) {
        assert(WriteBp(session.MutableBuffer(), 777, &error));
    }
    bool recorded = false;
    assert(session.CommitHistoryGroup(&recorded, nullptr, &error) && recorded);
    WriteFile(out_prefix + "-step3.sav", session.Buffer());

    // Step 4 (Unbound): Bag edit + dirty flag + MarkSaved + second bag edit
    if (is_unbound) {
        {
            const auto before = session.Buffer();
            assert(WriteSlot(session.MutableBuffer(), bag_offset, 13, 12, false));
            assert(CommitBagSectorChecksums(session.MutableBuffer(), &error));
            assert(session.RecordMutation(before, "bag_edit", "Edit Bag slot 1"));
        }
        assert(session.HasUncommittedBagChanges());
        assert(session.HasUnsavedChanges());
        session.MarkSaved();
        assert(!session.HasUncommittedBagChanges());
        assert(!session.HasUnsavedChanges());
        {
            const auto before = session.Buffer();
            assert(WriteSlot(session.MutableBuffer(), bag_offset, 13, 20, false));
            assert(CommitBagSectorChecksums(session.MutableBuffer(), &error));
            assert(session.RecordMutation(before, "bag_edit", "Edit Bag slot 2"));
        }
        assert(session.HasUncommittedBagChanges());
        assert(session.HasUnsavedChanges());
        WriteFile(out_prefix + "-step4.sav", session.Buffer());

        // Undo step 5 (bag edit 2) and step 4 (bag edit 1)
        LedgerEntrySummary undone;
        assert(session.UndoLastChange(&undone, &error));
        stream = BuildPcStream(session.Buffer(), &error);
        WriteFile(out_prefix + "-undo4.sav", session.Buffer());

        assert(session.UndoLastChange(&undone, &error));
        stream = BuildPcStream(session.Buffer(), &error);
    }

    // Undo step 3 (resources), step 2 (PC), step 1 (Party)
    LedgerEntrySummary undone;
    assert(session.UndoLastChange(&undone, &error));
    stream = BuildPcStream(session.Buffer(), &error);
    WriteFile(out_prefix + "-undo3.sav", session.Buffer());

    assert(session.UndoLastChange(&undone, &error));
    stream = BuildPcStream(session.Buffer(), &error);
    WriteFile(out_prefix + "-undo2.sav", session.Buffer());

    assert(session.UndoLastChange(&undone, &error));
    stream = BuildPcStream(session.Buffer(), &error);
    assert(session.Buffer() == original);
    assert(!session.CanUndo());
    WriteFile(out_prefix + "-undo1.sav", session.Buffer());

    // Bounded capacity eviction + full reset back to original on standalone ledger
    {
        ChangeLedger small_ledger(3);
        std::vector<uint8_t> buf = original;
        for (uint32_t i = 0; i < 6; ++i) {
            const auto prev = buf;
            assert(WriteMoney(buf, 10000 + i, &error));
            assert(small_ledger.Record(prev, buf, i == 0 ? "bag_edit" : "money_edit", "Bounded edit"));
        }
        assert(small_ledger.EntryCount() == 3);
        assert(small_ledger.HasUncommittedBagChanges());
        small_ledger.Reset(buf, original);
        assert(buf == original);
        assert(!small_ledger.HasUncommittedBagChanges());
    }

    // Session reset after re-edit restores exact original bytes
    {
        const auto before = session.Buffer();
        assert(WriteMoney(session.MutableBuffer(), 424242, &error));
        assert(session.RecordMutation(before, "money_edit", "Pre-reset edit"));
        assert(session.CanReset());
        session.ResetToOriginal();
        assert(session.Buffer() == original);
        assert(!session.CanUndo());
        assert(!session.CanReset());
        WriteFile(out_prefix + "-reset.sav", session.Buffer());
    }

    return 0;
}

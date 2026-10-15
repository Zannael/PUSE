#include <puse/core/GameProfile.hpp>
#include <puse/core/SaveSession.hpp>
#include <puse/core/SaveSections.hpp>
#include <cassert>
#include <puse/core/Pc.hpp>
#include <iostream>

int main(int argc, char** argv) {
    using namespace puse::core;
    assert(argc == 3);
    assert(profile::FindProfile("unknown") == nullptr);
    assert(profile::FindProfile(profile::kId) == &profile::kBuiltin);
    assert(profile::Identity(65535).native_id == 65535);
    assert(profile::Identity(65535).profile_id == profile::kId);
    size_t capacity = 0;
    for (auto region : profile::kPcRegions) capacity += region.end-region.start;
    assert(capacity == 41760);
    assert(UnboundChecksumLength(0) == 0xf24);
    assert(UnboundChecksumLength(13) == 0x450);
    assert(profile::CatalogAsset("pokemon.txt") == "data/pokemon.txt");
    assert(profile::CatalogAsset("unknown").empty());
    uint8_t raw[58] = {};
    assert(profile::InspectPcRecord(raw, 58, false) == profile::RecordState::Empty);
    raw[28] = 255; raw[29] = 255;
    assert(profile::InspectPcRecord(raw, 58, false) == profile::RecordState::Unknown);
    assert(profile::InspectPcRecord(raw, 58, true) == profile::RecordState::Known);
    SaveSession session;
    assert(session.Profile() == nullptr);
    assert(session.LoadFromFile(argv[1]));
    assert(session.Profile() == &profile::kBuiltin);
    assert(!session.LoadFromFile("/nonexistent/puse-profile-fixture"));
    assert(session.Profile() == &profile::kBuiltin);
    assert(session.ExportToFile(argv[2]));
    auto stream = BuildPcStream(session.Buffer());
    const auto original = stream;
    std::string error;
    assert(!InsertPcMon(stream, 1, 2, 1, 5, "", 0, "", {}, &error));
    assert(error == "slot is occupied" && stream == original);
    assert(ReleasePcMon(stream, 1, 3, &error));
    assert(std::equal(stream.begin()+58, stream.begin()+116, original.begin()+58));
    auto edited = session.Buffer();
    assert(CommitPcStream(edited, stream, &error));
    assert(BuildPcStream(edited) == stream);
    session.Clear();
    assert(session.Profile() == nullptr && !session.IsLoaded());
    std::cout << profile::kSerialized;
}

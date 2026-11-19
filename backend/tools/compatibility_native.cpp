#include <puse/core/SaveSession.hpp>
#include <cassert>
#include <fstream>
#include <iostream>
#include <iterator>
int main(int argc, char** argv) {
    assert(argc == 5);
    puse::core::SaveSession session;
    std::string error;
    assert(session.LoadFromFile(argv[4], &error, "unbound-2.1.1.1"));
    const auto original = session.Buffer();
    const auto* profile = session.Profile();
    std::ifstream in(argv[1], std::ios::binary);
    assert(in.good());
    const std::vector<uint8_t> bytes((std::istreambuf_iterator<char>(in)), {});
    const auto active = &puse::core::profile::Current();
    const auto report = puse::core::BuildCompatibilityReport(bytes, argv[2]);
    assert(active == &puse::core::profile::Current());
    const bool allowed = std::string(argv[3]) == "1";
    assert(report.mutations_allowed == allowed);
    assert(session.LoadFromFile(argv[1], &error, argv[2]) == allowed);
    if (!allowed) {
        assert(session.Buffer() == original && session.OriginalBuffer() == original);
        assert(session.Profile() == profile && active == &puse::core::profile::Current());
        assert(session.SourcePath() == argv[4]);
    }
    std::cout << puse::core::CompatibilityReportJson(report);
}

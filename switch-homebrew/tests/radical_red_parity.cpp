#include <puse/core/GameProfile.hpp>
#include <puse/core/SaveSession.hpp>
#include <puse/core/SaveSections.hpp>
#include <puse/core/Pc.hpp>
#include <puse/core/Party.hpp>
#include <puse/core/Bag.hpp>
#include <puse/core/Money.hpp>
#include <puse/core/PokedexFlags.hpp>
#include <fstream>
#include <cassert>
#include <iostream>
int main(int argc, char** argv) {
    using namespace puse::core;
    assert(argc == 4);
    SaveSession session; std::string error;
    assert(!session.LoadFromFile(argv[1], &error));
    assert(error.find("Explicit game/version selection required") != std::string::npos);
    assert(session.LoadFromFile(argv[1], &error, "radical-red-4.1"));
    assert(EnsurePartyStaticDataLoaded(&error));
    auto save=session.Buffer(); auto stream=BuildPcStream(save,&error);
    assert(stream.size()==43500 && PcStreamBoxCount()==25);
    const auto original=save;
    assert(CommitPcStream(save,stream,&error) && save==original);
    assert(!InsertPcMon(stream,1,1,1,5,"",0,"",{},&error));
    assert(!SetPokedexFlag(save,1,"caught",true,nullptr));
    assert(!WriteBp(save,5,&error) && save==original);
    auto damaged=save;
    const auto active=ActiveUnboundSections(save);
    for(const auto& sec:active)if(sec.section_id==4)damaged[sec.offset+4]^=1;
    assert(ActiveUnboundSections(damaged).front().save_index != active.front().save_index);
    const auto bag=ResolveQuickPockets(save);
    for(const auto& key:{"key","tm","ball"})assert(!WriteSlot(save,bag.at(key).anchor_offset,13,std::string(key)=="ball"?1:0,false));
    assert(save==original);
    TrainerIdentity trainer{};assert(ReadTrainerIdentity(save,&trainer));
    assert(profile::ShinyThreshold()==8 && !profile::Opaque(4));
    if(std::string(argv[3])=="edit") {
        assert(UpdatePartyHappiness(save,0,123,&error));
        assert(UpdatePartyItem(save,0,616,&error));
        assert(UpdatePartyNature(save,0,3,&error));
        assert(UpdatePartyMoves(save,0,{1003,999,0,33},std::array<uint8_t,4>{99,99,0,99},std::array<uint8_t,4>{3,2,0,1},&error));
        assert(UpdatePartyIdentity(save,0,true,std::nullopt,&error));
        assert(UpdatePartyNickname(save,0,"RR TEST",&error));
        assert(UpdatePartyOtName(save,0,"PUSE",&error));
        assert(UpdatePcMonHappiness(stream,25,1,91,&error));
        assert(CommitPcStream(save,stream,&error));
        assert(WriteMoney(save,123456789,&error));
        const auto pockets=ResolveQuickPockets(save);
        for(const auto &key: {"main","key","ball","tm","berry"}) {
            const auto rows=MapPocketFromAnchor(save,pockets.at(key).anchor_offset);
            assert(!rows.empty());
            const auto row=rows.front();
            assert(WriteSlot(save,row.offset,row.item_id,17,false));
        }
        const auto main=MapPocketFromAnchor(save,pockets.at("main").anchor_offset);
        assert(WriteSlot(save,main.front().offset,0,0,false));
    }
    std::ofstream out(argv[2],std::ios::binary); out.write(reinterpret_cast<const char*>(save.data()),save.size());
    std::cout << stream.size() << "\n";
}

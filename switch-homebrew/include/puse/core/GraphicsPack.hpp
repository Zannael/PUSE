// Portable graphics pack reader. Mirrored into both ports by sync_graphics_data.py.
#pragma once
#include <puse/core/GraphicsRegistry.hpp>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <unordered_map>
#include <vector>
#include <dirent.h>

namespace puse::core::graphics {
inline std::vector<std::string> Fields(const std::string& line) {
    std::vector<std::string> out; size_t start=0, end;
    while ((end=line.find('\t',start))!=std::string::npos) { out.push_back(line.substr(start,end-start)); start=end+1; }
    out.push_back(line.substr(start)); return out;
}
inline bool AssetPath(const std::string& path) {
    if (path.size()!=75 || path.substr(0,7)!="assets/" || path.substr(71)!=".png") return false;
    for (size_t i=7;i<71;++i) if (!((path[i]>='0'&&path[i]<='9')||(path[i]>='a'&&path[i]<='f'))) return false;
    return true;
}
inline bool Readable(const std::string& path) { FILE* f=std::fopen(path.c_str(),"rb"); if (!f) return false; std::fclose(f); return true; }
inline bool PngReadable(const std::string& path) {
    FILE* f=std::fopen(path.c_str(),"rb"); if (!f) return false;
    unsigned char bytes[8]; const size_t count=std::fread(bytes,1,8,f); std::fclose(f);
    const unsigned char expected[8]={137,80,78,71,13,10,26,10};
    if (count!=8) return false;
    for (unsigned i=0;i<8;++i) if (bytes[i]!=expected[i]) return false;
    return true;
}
class Pack {
    std::string root_;
    std::unordered_map<std::string,std::string> assets_;
    std::unordered_map<unsigned,unsigned> female_;
    unsigned unown_=0, first_unown_=0;
public:
    bool Load(const std::string& root, const std::string& profile) {
        root_.clear(); assets_.clear(); female_.clear(); unown_=first_unown_=0;
        FILE* file=std::fopen((root+"/resources.tsv").c_str(),"rb"); if (!file) return false;
        char buffer[256]; bool valid=false; unsigned rows=0;
        while (std::fgets(buffer,sizeof(buffer),file)) {
            std::string line(buffer); if (line.size()>254 || ++rows>40000) { valid=false; break; }
            while (!line.empty()&&(line.back()=='\n'||line.back()=='\r')) line.pop_back();
            const auto f=Fields(line);
            if (rows==1) {
                valid=f.size()==4&&f[0]=="PUSE-GRAPHICS"&&f[1]=="1"&&f[2]==profile&&Trusted(profile,f[3]);
                if (!valid) break;
            } else if (f.size()==3&&f[0]=="@female") female_[std::strtoul(f[1].c_str(),nullptr,10)]=std::strtoul(f[2].c_str(),nullptr,10);
            else if (f.size()==3&&f[0]=="@unown") { unown_=std::strtoul(f[1].c_str(),nullptr,10); first_unown_=std::strtoul(f[2].c_str(),nullptr,10); }
            else if (f.size()==2&&AssetPath(f[1])) assets_[f[0]]=f[1];
            else { valid=false; break; }
        }
        std::fclose(file);
        if (!valid || assets_.empty()) { assets_.clear(); return false; }
        root_=root; return true;
    }
    std::string Resolve(const std::string& key) const {
        const auto it=assets_.find(key); if (it==assets_.end()) return "";
        const auto path=root_+"/"+it->second; return PngReadable(path)?path:"";
    }
    std::string Pokemon(unsigned species, bool shiny=false, const std::string& gender="", uint32_t pid=0, bool has_pid=false) const {
        if (gender=="female") { const auto it=female_.find(species); if (it!=female_.end()) species=it->second; }
        if (species==unown_&&has_pid) {
            const unsigned letter=(((pid&0x03000000)>>18)|((pid&0x00030000)>>12)|((pid&0x300)>>6)|(pid&3))%28;
            if (letter) species=first_unown_+letter-1;
        }
        return Resolve("pokemon/"+std::to_string(species)+(shiny?"/shiny/front/0":"/normal/front/0"));
    }
    std::string Item(unsigned id) const { return Resolve("items/"+std::to_string(id)); }
};
inline Pack& CachedPack(const std::string& root, const std::string& profile) {
    static std::unordered_map<std::string,Pack> cache;
    const std::string key=root+"/"+profile;
    auto it=cache.find(key);
    if (it==cache.end()) { Pack pack; pack.Load(key,profile); it=cache.emplace(key,std::move(pack)).first; }
    return it->second;
}
inline std::string FindPokemon(const std::vector<std::string>& roots, const std::string& profile, unsigned id, bool shiny=false, const std::string& gender="", uint32_t pid=0, bool has_pid=false) {
    for (const auto& root:roots) { const auto path=CachedPack(root,profile).Pokemon(id,shiny,gender,pid,has_pid); if (!path.empty()) return path; }
    return "";
}
inline std::string FindItem(const std::vector<std::string>& roots, const std::string& profile, unsigned id) {
    for (const auto& root:roots) { const auto path=CachedPack(root,profile).Item(id); if (!path.empty()) return path; }
    return "";
}
inline std::string FindFile(const std::string& root, const std::string& name, unsigned depth=0) {
    if (name.empty()||depth>6) return "";
    if (Readable(root+"/"+name)) return root+"/"+name;
    DIR* dir=opendir(root.c_str()); if (!dir) return "";
    std::string found; dirent* entry;
    while ((entry=readdir(dir))!=nullptr) {
        const std::string part=entry->d_name;
        if (part.empty()||part[0]=='.'||entry->d_type==DT_LNK) continue;
        if (entry->d_type==DT_DIR) { found=FindFile(root+"/"+part,name,depth+1); if (!found.empty()) break; }
    }
    closedir(dir); return found;
}
// The generated fallback index is shared across ports and backend/browser.
inline std::string SharedName(const std::string& index, const std::string& profile, const std::string& kind, unsigned id) {
    FILE* file=std::fopen(index.c_str(),"rb"); if (!file) return "";
    const std::string key=profile+"\t"+kind+"\t"+std::to_string(id); char buffer[512]; std::string result;
    while (std::fgets(buffer,sizeof(buffer),file)) {
        std::string line(buffer); const auto pos=line.rfind('\t');
        if (pos!=std::string::npos&&line.substr(0,pos)==key) {
            result=line.substr(pos+1); while (!result.empty()&&(result.back()=='\n'||result.back()=='\r')) result.pop_back();
            if (result.find('/')!=std::string::npos||result.find('\\')!=std::string::npos||result.find("..")!=std::string::npos) result.clear();
            break;
        }
    }
    std::fclose(file); return result;
}
}

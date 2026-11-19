#include <puse/core/GraphicsPack.hpp>
#include <iostream>
int main(int argc, char** argv) {
    if (argc!=3) return 2;
    puse::core::graphics::Pack pack;
    if (!pack.Load(argv[1],argv[2])) return 3;
    std::cout << pack.Pokemon(1) << '\n' << pack.Pokemon(1,true) << '\n'
              << pack.Pokemon(502,false,"female") << '\n'
              << pack.Pokemon(201,false,"",1,true) << '\n' << pack.Item(503) << '\n';
}

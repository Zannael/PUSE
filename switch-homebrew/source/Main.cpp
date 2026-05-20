#include <MainApplication.hpp>

#include <cstdio>

#include <switch.h>

extern "C" {
Result g_romfs_primary_rc = 0;
Result g_romfs_fallback_rc = 0;
int g_romfs_mount_mode = 0;
bool g_romfs_marker_ok = false;
}

namespace {

bool g_romfs_mounted = false;

bool ProbeRomfsMarker() {
    FILE *fp = std::fopen("romfs:/data/items.txt", "rb");
    if (fp == nullptr) {
        return false;
    }
    std::fclose(fp);
    return true;
}

void MountRomFs() {
    g_romfs_fallback_rc = romfsInit();
    if (R_SUCCEEDED(g_romfs_fallback_rc)) {
        g_romfs_mount_mode = 2;
        g_romfs_mounted = true;
        g_romfs_marker_ok = ProbeRomfsMarker();
        if (g_romfs_marker_ok) {
            return;
        }

        romfsExit();
        g_romfs_mounted = false;
        g_romfs_mount_mode = 0;
    }

    g_romfs_primary_rc = romfsMountFromCurrentProcess("romfs");
    if (R_SUCCEEDED(g_romfs_primary_rc)) {
        g_romfs_mount_mode = 1;
        g_romfs_mounted = true;
        g_romfs_marker_ok = ProbeRomfsMarker();
        if (g_romfs_marker_ok) {
            return;
        }

        romfsUnmount("romfs");
        g_romfs_mounted = false;
        g_romfs_mount_mode = 0;
    }

    g_romfs_mount_mode = 0;
    g_romfs_mounted = false;
    g_romfs_marker_ok = false;
}

} // namespace

extern "C" void userAppExit() {
    if (g_romfs_mounted) {
        if (g_romfs_mount_mode == 1) {
            romfsUnmount("romfs");
        } else {
            romfsExit();
        }
    }
}

int main() {
    MountRomFs();

    auto renderer_opts = pu::ui::render::RendererInitOptions(SDL_INIT_EVERYTHING, pu::ui::render::RendererHardwareFlags);
    renderer_opts.UseImage(pu::ui::render::ImgAllFlags);
    renderer_opts.SetPlServiceType(PlServiceType_User);
    renderer_opts.AddDefaultAllSharedFonts();
    renderer_opts.SetInputPlayerCount(1);
    renderer_opts.AddInputNpadStyleTag(HidNpadStyleSet_NpadStandard);
    renderer_opts.AddInputNpadIdType(HidNpadIdType_Handheld);
    renderer_opts.AddInputNpadIdType(HidNpadIdType_No1);

    auto renderer = pu::ui::render::Renderer::New(renderer_opts);
    auto app = puse::ui::MainApplication::New(renderer);

    const auto rc = app->Load();
    if (R_FAILED(rc)) {
        diagAbortWithResult(rc);
    }

    app->Show();
    return 0;
}

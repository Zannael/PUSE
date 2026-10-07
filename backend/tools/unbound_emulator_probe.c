/* Headless validation adapter for mGBA's public core API.
 * Build against mGBA 0.10.5; see CFRU_IMPLEMENTATION_PLAN.md.
 * Saves and RAM dumps are private temporary test artifacts, never fixtures.
 */
#include <mgba/core/core.h>
#include <mgba/core/config.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(int argc, char **argv) {
    if (argc != 3) return 2;
    struct mCore *core = mCoreFind(argv[1]);
    if (!core || !core->init(core)) return 3;
    mCoreInitConfig(core, "puse-validation");
    mCoreConfigSetIntValue(&core->config, "useBios", 0);
    mCoreConfigSetIntValue(&core->config, "skipBios", 1);
    mCoreLoadConfig(core);
    color_t *pixels = calloc(256 * 256, sizeof(color_t));
    core->setVideoBuffer(core, pixels, 256);
    if (!mCoreLoadFile(core, argv[1]) || !mCoreLoadSaveFile(core, argv[2], false)) return 4;
    core->reset(core);
    char line[2048], path[1024];
    unsigned frames, keys, address, length;
    while (fgets(line, sizeof(line), stdin)) {
        if (sscanf(line, "frames %u %u", &frames, &keys) == 2) {
            core->setKeys(core, keys);
            for (unsigned i = 0; i < frames; ++i) core->runFrame(core);
        } else if (sscanf(line, "read %x %u %1023s", &address, &length, path) == 3) {
            FILE *file = fopen(path, "wb");
            if (!file) return 5;
            for (unsigned i = 0; i < length; ++i) {
                unsigned char byte = core->busRead8(core, address + i);
                fwrite(&byte, 1, 1, file);
            }
            fclose(file);
        } else if (sscanf(line, "save %1023s", path) == 1) {
            void *data = NULL;
            size_t size = core->savedataClone(core, &data);
            FILE *file = fopen(path, "wb");
            if (!file || !size) return 6;
            fwrite(data, 1, size, file);
            fclose(file);
            free(data);
        } else if (!strncmp(line, "quit", 4)) {
            break;
        } else {
            return 7;
        }
    }
    core->deinit(core);
    free(pixels);
    return 0;
}

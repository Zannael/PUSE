#!/usr/bin/env bash
# Build puse-3ds.cia using makerom + bannertool inside the puse-3ds-dev Docker image.
# Requires: puse-3ds.elf, puse-3ds.smdh, romfs/, puse-3ds.rsf all present.
# Outputs: puse-3ds.cia

set -e
cd "$(dirname "$0")/.."

REPO_ROOT="$(pwd)"
IMAGE="puse-3ds-dev"

# Ensure .3dsx / .elf / .smdh exist (build if missing)
if [ ! -f "puse-3ds.elf" ]; then
    echo ">>> puse-3ds.elf not found — building first..."
    scripts/build_docker.sh
fi

echo ">>> Building CIA..."
docker run --rm \
    -v "$REPO_ROOT":/work \
    -w /work \
    "$IMAGE" \
    sh -lc '
        set -e

        # Create a minimal banner PNG (256x128 solid navy) if none provided
        if [ ! -f banner.png ]; then
            python3 -c "
import struct, zlib
def png_chunk(t,d): return struct.pack(\"!I\",len(d))+t+d+struct.pack(\"!I\",zlib.crc32(t+d)&0xffffffff)
sig=b\"\\x89PNG\\r\\n\\x1a\\n\"
ihdr=struct.pack(\"!IIBBBBB\",256,128,8,2,0,0,0)
raw=b\"\"
for y in range(128): raw+=b\"\\x00\"+b\"\\x10\\x16\\x23\"*256
comp=zlib.compress(raw,9)
print(\"writing banner.png\")
open(\"banner.png\",\"wb\").write(sig+png_chunk(b\"IHDR\",ihdr)+png_chunk(b\"IDAT\",comp)+png_chunk(b\"IEND\",b\"\"))
"
        fi

        # Create a minimal 16-bit PCM WAV (0.5s silence at 22050 Hz) if none provided
        if [ ! -f banner.wav ]; then
            python3 -c "
import struct
sr,ch,bits,dur=22050,1,16,1
nsamp=sr*dur
data=b\"\\x00\\x00\"*nsamp
hdr=struct.pack(\"<4sI4s4sIHHIIHH4sI\",b\"RIFF\",36+len(data),b\"WAVE\",b\"fmt \",16,1,ch,sr,sr*ch*bits//8,ch*bits//8,bits,b\"data\",len(data))
open(\"banner.wav\",\"wb\").write(hdr+data)
print(\"writing banner.wav\")
"
        fi

        # Build banner.bnr
        bannertool makebanner -i banner.png -a banner.wav -o banner.bnr

        # Build icon (reuse smdh)
        bannertool makesmdh \
            -s "PUSE 3DS" \
            -l "Pokemon Unbound Save Editor" \
            -p "zappaganini" \
            -i icon.png \
            -o icon.icn 2>/dev/null || cp puse-3ds.smdh icon.icn

        # Build CIA
        makerom \
            -f cia \
            -o puse-3ds.cia \
            -elf puse-3ds.elf \
            -rsf puse-3ds.rsf \
            -banner banner.bnr \
            -icon icon.icn \
            -target t

        echo ">>> puse-3ds.cia built"
        ls -lh puse-3ds.cia
    '

# Fix ownership
docker run --rm -v "$REPO_ROOT":/work "$IMAGE" \
    sh -lc "chown $(id -u):$(id -g) /work/puse-3ds.cia /work/banner.bnr /work/banner.png /work/banner.wav /work/icon.icn 2>/dev/null || true"

echo ">>> CIA build done"

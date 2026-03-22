import argparse, struct, shutil, os

SECTION_SIZE = 0x1000
FOOTER_VALIDLEN_OFF = 0xFF0
FOOTER_ID_OFF = 0xFF4
FOOTER_CHK_OFF = 0xFF6
FOOTER_SAVEINDEX_OFF = 0xFFC

TRAINER_SECTION_ID = 1
# fallback u32 offset we observed; used only if search fails
FALLBACK_OFF_MONEY = 0x290
MIN_MONEY = 0
MAX_MONEY = 999999

def ru16(b,o): return struct.unpack_from("<H", b, o)[0]
def ru32(b,o): return struct.unpack_from("<I", b, o)[0]
def wu32(b,o,v): struct.pack_into("<I", b, o, v)

def to_bcd3(n: int) -> bytes:
    s = f"{n:06d}"
    b0 = (int(s[1]) << 4) | int(s[0])
    b1 = (int(s[3]) << 4) | int(s[2])
    b2 = (int(s[5]) << 4) | int(s[4])
    return bytes([b0, b1, b2])

def find_all(hay: bytes, needle: bytes):
    out, pos = [], 0
    while True:
        p = hay.find(needle, pos)
        if p < 0: break
        out.append(p)
        pos = p + 1
    return out


def clamp_money(value: int) -> int:
    return max(MIN_MONEY, min(MAX_MONEY, int(value)))

def compute_section_checksum(payload: bytes, valid_len: int) -> int:
    # Se valid_len è 0 o non sensato, usa tutta l'area payload
    if not (0 < valid_len <= len(payload)):
        L = len(payload)
    else:
        L = valid_len
    pad = (4 - (L % 4)) % 4
    p = payload[:L] + b"\x00"*pad
    total = 0
    for i in range(0, len(p), 4):
        total = (total + struct.unpack_from("<I", p, i)[0]) & 0xFFFFFFFF
    lower = total & 0xFFFF
    upper = (total >> 16) & 0xFFFF
    return (lower + upper) & 0xFFFF


def list_sections(buf: bytes):
    n = len(buf) // SECTION_SIZE
    secs = []
    for i in range(n):
        off = i * SECTION_SIZE
        chunk = buf[off:off+SECTION_SIZE]
        if len(chunk) < SECTION_SIZE: break
        sect_id = ru16(chunk, FOOTER_ID_OFF)
        valid_len = ru32(chunk, FOOTER_VALIDLEN_OFF)
        chk = ru16(chunk, FOOTER_CHK_OFF)
        saveidx = ru32(chunk, FOOTER_SAVEINDEX_OFF)
        secs.append({
            "index": i, "off": off, "id": sect_id, "valid_len": valid_len,
            "chk": chk, "saveidx": saveidx, "data": bytearray(chunk)
        })
    return secs

def selfcheck_print(secs):
    print("Self-check id=1 sections:")
    for s in secs:
        off = s["off"]
        payload = bytes(s["data"][:FOOTER_ID_OFF])
        calc = compute_section_checksum(payload, s["valid_len"])
        print(f" - file_off=0x{off:06X} index={s['index']} saveidx={s['saveidx']} chk_stored=0x{s['chk']:04X} chk_calc=0x{calc:04X} {'OK' if calc==s['chk'] else 'MISMATCH'}")

def patch_money_everywhere(buf: bytes, new_money: int, dryrun=False):
    new_money = clamp_money(new_money)
    out = bytearray(buf)
    secs = list_sections(buf)
    trainer_secs = [s for s in secs if s["id"] == TRAINER_SECTION_ID]

    if not trainer_secs:
        raise RuntimeError("No trainer sections (id=1) found in save.")

    print(f"Found {len(trainer_secs)} section(s) with id=1 — patching all of them.")

    for s in trainer_secs:
        off = s["off"]
        sec = bytearray(out[off:off+SECTION_SIZE])  # mutable copy of this section
        valid_len = s["valid_len"]

        # payload area (where checksum is computed over)
        payload = bytearray(sec[:FOOTER_ID_OFF])

        # record prior state for logging
        prior_chk = ru16(sec, FOOTER_CHK_OFF)
        prior_money_u32 = None
        found_u32_offsets = find_all(bytes(payload), struct.pack("<I", new_money))  # this will find new value if already present
        # but want old value locations: search for any plausible existing 4-byte number near fallback
        # We'll attempt to detect existing money u32 by searching backwards from fallback, otherwise search for any 6-digit packed bcd too

        # Try to find current u32 occurrences by searching for any 4-byte little-endian integers that look like money (<= 999999)
        u32_candidates = []
        for p in range(0, len(payload)-3):
            val = struct.unpack_from("<I", payload, p)[0]
            if 0 <= val <= 999999:
                u32_candidates.append((p,val))
        # prefer ones near FALLBACK_OFF_MONEY
        u32_candidates.sort(key=lambda x: abs(x[0]-FALLBACK_OFF_MONEY))
        u32_offset = u32_candidates[0][0] if u32_candidates else FALLBACK_OFF_MONEY
        prior_money_u32 = struct.unpack_from("<I", payload, u32_offset)[0]

        # find packed BCD3 for prior money by scanning for any 3-byte pattern that's valid BCD for 6 digits
        def is_valid_bcd3(b):
            # each nibble 0-9
            for byte in b:
                if ((byte>>4) & 0xF) > 9 or (byte & 0xF) > 9:
                    return False
            return True

        bcd_offsets = [p for p in range(0, len(payload)-2) if is_valid_bcd3(payload[p:p+3])]
        bcd_offset = None
        if bcd_offsets:
            # choose one nearest to u32 offset - 3
            target = max(0, u32_offset - 3)
            bcd_offsets.sort(key=lambda x: abs(x-target))
            bcd_offset = bcd_offsets[0]

        # For robustness: if no reasonable candidate, use fallback positions
        if u32_offset is None:
            u32_offset = FALLBACK_OFF_MONEY
        if bcd_offset is None:
            # try u32_offset - 3 as likely
            cand = max(0, u32_offset - 3)
            bcd_offset = cand

        # Logging before change
        calc_before = compute_section_checksum(bytes(payload), valid_len)
        print(f"\nPatching section @ file_off=0x{off:06X} index={s['index']} saveidx={s['saveidx']}")
        print(f" - chosen u32_offset = 0x{u32_offset:X} (prior={prior_money_u32})")
        print(f" - chosen bcd_offset = 0x{bcd_offset:X}")
        print(f" - checksum before: stored=0x{prior_chk:04X}, calc=0x{calc_before:04X}")

        # apply changes to payload
        struct.pack_into("<I", payload, u32_offset, new_money)
        bcd = to_bcd3(new_money)
        payload[bcd_offset:bcd_offset+3] = bcd

        # recompute checksum and write back
        newchk = compute_section_checksum(bytes(payload), valid_len)
        sec[:FOOTER_ID_OFF] = payload
        struct.pack_into("<H", sec, FOOTER_CHK_OFF, newchk)

        calc_after = compute_section_checksum(bytes(sec[:FOOTER_ID_OFF]), valid_len)
        print(f" - checksum after: newchk=0x{newchk:04X}, calc_after=0x{calc_after:04X} {'OK' if newchk==calc_after else 'BAD'}")
        if dryrun:
            print(" - dryrun: not writing changes for this section.")
            continue

        # write patched section back into output buffer
        out[off:off+SECTION_SIZE] = sec

    return bytes(out)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("sav")
    ap.add_argument("--read", action="store_true")
    ap.add_argument("--set", type=int, help="set money value (integer)")
    ap.add_argument("--out", help="output sav (if setting)")
    ap.add_argument("--selfcheck", action="store_true", help="print checksums for id=1 sections")
    args = ap.parse_args()

    with open(args.sav, "rb") as f:
        buf = f.read()

    secs = list_sections(buf)
    trainer_secs = [s for s in secs if s["id"] == TRAINER_SECTION_ID]
    if not trainer_secs:
        print("No trainer sections found.")
        return

    if args.selfcheck:
        selfcheck_print(trainer_secs)
        # optionally read current money (from first trainer section using fallback offset)
        first = trainer_secs[0]
        payload = bytes(first["data"][:FOOTER_ID_OFF])
        try:
            val = ru32(payload, FALLBACK_OFF_MONEY)
            print(f"First trainer section money u32 @ 0x{FALLBACK_OFF_MONEY:X} = {val} (may be garbage if different layout)")
        except Exception:
            pass
        return

    if args.read:
        # read money from first trainer section (best guess)
        first = trainer_secs[0]
        payload = bytes(first["data"][:FOOTER_ID_OFF])
        # try to read u32 at fallback
        money = ru32(payload, FALLBACK_OFF_MONEY)
        print("Guessed current money (u32 at fallback offset) =", money)
        return

    if args.set is not None:
        outpath = args.out or args.sav.replace(".sav", "_money.sav")
        backup = args.sav + ".bak"
        print(f"Creating backup: {backup}")
        shutil.copyfile(args.sav, backup)

        print(f"Patching money -> {args.set} ...")
        outbuf = patch_money_everywhere(buf, args.set, dryrun=False)

        with open(outpath, "wb") as f:
            f.write(outbuf)
        print(f"Wrote {outpath} with money={args.set}")
        # post-write selfcheck
        print("\nPost-write selfcheck (on output file):")
        secs_out = list_sections(outbuf)
        trainer_out = [s for s in secs_out if s["id"]==TRAINER_SECTION_ID]
        selfcheck_print(trainer_out)
        return

if __name__ == "__main__":
    main()

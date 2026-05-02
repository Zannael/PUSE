#!/usr/bin/env python3

SAVE_BODY_LEN = 0x20000
SAVE_WITH_TRAILER_LEN = 0x20010
RTC_TRAILER_LEN = 0x10


def normalize_target_ext(target_ext: str) -> str:
    ext = str(target_ext or "").strip().lower()
    if not ext.startswith("."):
        ext = f".{ext}"
    if ext not in {".sav", ".srm"}:
        raise ValueError("target_ext must be .sav or .srm")
    return ext


def convert_save_bytes(raw: bytes, target_ext: str) -> bytes:
    ext = normalize_target_ext(target_ext)
    size = len(raw)

    if size not in {SAVE_BODY_LEN, SAVE_WITH_TRAILER_LEN}:
        raise ValueError(
            f"Unsupported save size: {size} bytes. Expected {SAVE_BODY_LEN} or {SAVE_WITH_TRAILER_LEN}."
        )

    if ext == ".srm":
        if size == SAVE_WITH_TRAILER_LEN:
            return raw[:SAVE_BODY_LEN]
        return raw

    if size == SAVE_BODY_LEN:
        return raw + (b"\x00" * RTC_TRAILER_LEN)
    return raw

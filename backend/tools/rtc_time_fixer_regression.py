#!/usr/bin/env python3
"""Regression checks for the minimal in-game Time Fixer reset."""

try:
    from .rtc_repair_from_pair import (
        SAVE_BODY_LEN,
        SAVE_WITH_TRAILER_LEN,
        TIME_FIXER_REL_OFF,
        TIME_FIXER_USED_MASK,
        UNBOUND_SECTION_SIGNATURE,
        compute_layout_offset_for_saveidx,
        reenable_time_fixer,
        wu16,
        wu32,
    )
except ImportError:
    from rtc_repair_from_pair import (
        SAVE_BODY_LEN,
        SAVE_WITH_TRAILER_LEN,
        TIME_FIXER_REL_OFF,
        TIME_FIXER_USED_MASK,
        UNBOUND_SECTION_SIGNATURE,
        compute_layout_offset_for_saveidx,
        reenable_time_fixer,
        wu16,
        wu32,
    )


def build_save(*, active_flag=True, trailer=True):
    size = SAVE_WITH_TRAILER_LEN if trailer else SAVE_BODY_LEN
    out = bytearray([0xA5] * size)
    if trailer:
        out[SAVE_BODY_LEN:] = bytes(range(16))

    for save_idx in (40, 41):
        for sid in range(14):
            off = compute_layout_offset_for_saveidx(sid, save_idx)
            out[off:off + 0x1000] = bytes([sid]) * 0x1000
            wu32(out, off + 0xFF0, 0)
            wu16(out, off + 0xFF4, sid)
            wu16(out, off + 0xFF6, 0x5C4B)
            wu32(out, off + 0xFF8, UNBOUND_SECTION_SIGNATURE)
            wu32(out, off + 0xFFC, save_idx)

    active_off = compute_layout_offset_for_saveidx(4, 41)
    older_off = compute_layout_offset_for_saveidx(4, 40)
    out[active_off + TIME_FIXER_REL_OFF] = 0x08 | (TIME_FIXER_USED_MASK if active_flag else 0)
    out[older_off + TIME_FIXER_REL_OFF] = 0x28
    return bytes(out), active_off, older_off


def expect_failure(payload, text):
    try:
        reenable_time_fixer(payload)
    except ValueError as exc:
        assert text in str(exc), (text, str(exc))
    else:
        raise AssertionError(f"Expected failure containing: {text}")


def main():
    source, active_off, older_off = build_save()
    result = reenable_time_fixer(source)
    output = result["bytes"]
    target = active_off + TIME_FIXER_REL_OFF

    assert result["save_idx"] == 41
    assert result["section_offset"] == active_off
    assert result["absolute_offset"] == target
    assert result["before"] == 0x28 and result["after"] == 0x08
    assert output[target] == 0x08
    assert output[older_off + TIME_FIXER_REL_OFF] == 0x28
    assert output[active_off + 0xFF0:active_off + 0x1000] == source[active_off + 0xFF0:active_off + 0x1000]
    assert output[SAVE_BODY_LEN:] == source[SAVE_BODY_LEN:]
    assert [idx for idx, pair in enumerate(zip(source, output)) if pair[0] != pair[1]] == [target]

    already_clear, _, _ = build_save(active_flag=False)
    expect_failure(already_clear, "already available")
    expect_failure(source[:-1], "Unsupported save size")

    invalid_signature = bytearray(source)
    wu32(invalid_signature, active_off + 0xFF8, 0)
    # The older coherent generation remains valid and is intentionally selected.
    older_result = reenable_time_fixer(bytes(invalid_signature))
    assert older_result["save_idx"] == 40

    no_valid_generation = bytearray(source)
    for save_idx in (40, 41):
        off = compute_layout_offset_for_saveidx(4, save_idx)
        wu32(no_valid_generation, off + 0xFF8, 0)
    expect_failure(bytes(no_valid_generation), "No coherent")

    print("[PASS] RTC Time Fixer reset changes one byte and preserves fallback/footer/trailer")


if __name__ == "__main__":
    main()

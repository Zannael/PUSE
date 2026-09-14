#!/usr/bin/env python3
"""Regression checks for ROM-truth battle-stat and Hidden Power previews."""

import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from modules import party


def main():
    party.load_static_data()
    cases = [
        (
            "Pikachu L50 neutral",
            25,
            50,
            0,
            {"HP": 31, "Atk": 31, "Def": 31, "SpA": 31, "SpD": 31, "Spd": 31},
            {"HP": 0, "Atk": 0, "Def": 0, "SpA": 0, "SpD": 0, "Spd": 0},
            {"HP": 110, "Atk": 75, "Def": 60, "SpA": 70, "SpD": 70, "Spe": 110},
        ),
        (
            "Pikachu L100 Jolly trained",
            25,
            100,
            13,
            {"HP": 31, "Atk": 31, "Def": 31, "SpA": 31, "SpD": 31, "Spe": 31},
            {"HP": 0, "Atk": 252, "Def": 0, "SpA": 0, "SpD": 4, "Spe": 252},
            {"HP": 211, "Atk": 209, "Def": 116, "SpA": 122, "SpD": 137, "Spe": 306},
        ),
    ]
    for label, species_id, level, nature_id, ivs, evs, expected in cases:
        actual = party.calculate_battle_stats(species_id, level, nature_id, ivs, evs)
        assert actual == expected, f"{label}: expected {expected}, got {actual}"

    assert party.calculate_hidden_power_type({key: 30 for key in ("HP", "Atk", "Def", "SpA", "SpD", "Spe")}) == "Fighting"
    assert party.calculate_hidden_power_type({key: 31 for key in ("HP", "Atk", "Def", "SpA", "SpD", "Spd")}) == "Dark"
    print("battle preview regression passed")


if __name__ == "__main__":
    main()

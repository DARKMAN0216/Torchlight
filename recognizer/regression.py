from __future__ import annotations

import sys
from pathlib import Path

import cv2

from server import GameRecognizer
from choice_tracking import ChoiceTracker


SAMPLES = {
    'round-1-raised-permanent-choice-2560x1440.png': (1, 408, 4, 3),
    "round-5-short-name-retry-2560x1440.png": (5, 108688, 4, 3),
    "round-1-before-birth-bone-powder-1920x1080.png": (1, 720, 4, 3),
    "round-4-large-potion-box-expanded-1920x1080.png": (4, 16650, 2, 5),
    "round-10-current-checkpoint-1920x1080.png": (10, 425722, 1, 3),
    "round-11-surgery-plan-selection-1920x1080.png": (11, 463722, 1, 3),
    "round-1-rarity-sync-2560x1440.png": (1, 228, 4, 3),
    "round-7-rarity-icon-regression-2560x1440.png": (7, 118200, 4, 3),
}


def main() -> None:
    project_root = Path(__file__).resolve().parent.parent
    references = project_root / "design" / "references"
    recognizer = GameRecognizer()
    failed = False

    for filename, expected in SAMPLES.items():
        image = cv2.imread(str(references / filename))
        if image is None:
            print(f"FAIL {filename}: 无法读取图片")
            failed = True
            continue
        payload = recognizer.recognize(image, filename)
        snapshot = payload["snapshot"]
        actual = (
            snapshot.get("round", {}).get("value"),
            snapshot.get("displayedFinalActivity", {}).get("value"),
            sum(1 for slot in snapshot["monsterSlots"] if slot["occupied"]["value"]),
            len(snapshot.get("candidateCardNames", [])),
        )
        ok = actual == expected and not payload["diagnostics"]["issues"]
        if filename == 'round-1-raised-permanent-choice-2560x1440.png':
            names = [item['value'] for item in snapshot['candidateCardNames']]
            tracker = ChoiceTracker()
            tracker.payload()
            tracker.observe(snapshot, (123, 0, 0, 2560, 1440))
            ok = ok and names == ['斑斓肝脏', '肿大脑垂体', '人蛹标本']
            ok = ok and snapshot['phase']['value'] == 'surgeryRewardSelection' and tracker.context is not None
            print(f"  phase={snapshot['phase']}; names={names}; choiceArmed={tracker.context is not None}")
        if filename == 'round-5-short-name-retry-2560x1440.png':
            third = snapshot['monsterSlots'][2]
            ok = ok and third.get('name', {}).get('value') == '蝎兽'
            ok = ok and third['name']['confidence'] >= .85
            ok = ok and third.get('raceId', {}).get('value') == 'aberrant'
            ok = ok and third.get('quantity', {}).get('value') == 78
            ok = ok and third.get('unitActivity', {}).get('value') == 141
        if filename == "round-1-rarity-sync-2560x1440.png":
            actual_attributes = [(slot.get("raceId", {}).get("value"), slot.get("rarity", {}).get("value"))
                                 for slot in snapshot["monsterSlots"][:4]]
            expected_attributes = [("construct", "common"), ("construct", "common"),
                                   ("awakened", "common"), ("awakened", "magic")]
            ok = ok and actual_attributes == expected_attributes
            print(f"  attributes={actual_attributes}")
        if filename == "round-7-rarity-icon-regression-2560x1440.png":
            attributes = [(slot.get('raceId', {}).get('value'), slot.get('rarity', {}).get('value'))
                          for slot in snapshot['monsterSlots'][:4]]
            names = [item['value'] for item in snapshot['candidateCardNames']]
            ok = ok and attributes == [('aberrant','rare'),('awakened','common'),('awakened','rare'),('construct','magic')]
            ok = ok and names == ['鲜脊髓药粉', '清疽油膏', '活性育卵激素']
            print(f"  attributes={attributes}; names={names}")
        print(
            f"{'PASS' if ok else 'FAIL'} {filename}: "
            f"round={actual[0]}, activity={actual[1]}, groups={actual[2]}, cards={actual[3]}, "
            f"{payload['diagnostics']['latencyMs']} ms"
        )
        if not ok:
            print(f"  expected={expected}; issues={payload['diagnostics']['issues']}")
            failed = True

    raise SystemExit(1 if failed else 0)


if __name__ == "__main__":
    main()

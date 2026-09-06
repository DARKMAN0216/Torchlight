from __future__ import annotations

import argparse
import ctypes
import json
import re
import sys
import threading
import time
import uuid
from collections import deque
from contextlib import contextmanager
from ctypes import wintypes
from dataclasses import dataclass
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from rapidocr import RapidOCR
from follow import FollowController
from choice_tracking import ChoiceTracker, run_mouse_listener
from phase_detection import detect_phase


REGIONS = {
    "round": (0.041, 0.348, 0.068, 0.065),
    "final_activity": (0.039, 0.439, 0.073, 0.041),
    "selection": (0.285, 0.620, 0.485, 0.330),
}

MONSTER_SUMMARIES = [
    (0.165, 0.342, 0.112, 0.080),
    (0.301, 0.342, 0.112, 0.080),
    (0.438, 0.342, 0.112, 0.080),
    (0.574, 0.342, 0.112, 0.080),
    (0.711, 0.342, 0.112, 0.080),
    (0.847, 0.342, 0.112, 0.080),
]

# 培养罐下方名称左侧的小图标：使用用户提供的当前游戏截图模板。
# 图标比怪物名 OCR 稳定，尤其是名称被特效、低分辨率或字体影响时。
MONSTER_ICON_REGIONS = [
    (x, 0.322, width, 0.115)
    for x, _, width, _ in MONSTER_SUMMARIES
]
MONSTER_ICON_TEMPLATE_REFERENCE_WIDTH = 2560
MONSTER_ICON_CONFIDENCE = 0.80

MONSTER_RACES = {
    "红斑金鱼": "swarm",
    "巡察卫兵": "construct",
    "禁典学者": "awakened",
    "邪眼翼兽": "aberrant",
    "蝙兽": "aberrant",
    "蝎兽": "aberrant",
}

PHASE_WORDS = (
    ("手术方案", "surgeryPlanSelection"),
    ("手术用具", "surgeryRewardSelection"),
    ("药剂", "potionSelection"),
)

TORCHLIGHT_WINDOW_TITLE = "Torchlight: Infinite"
TORCHLIGHT_PROCESS_NAME = "torchlight_infinite.exe"
HOTKEY_ID = 0x564F
HOTKEY_MOD_NOREPEAT = 0x4000
HOTKEY_VK_F8 = 0x77
WM_HOTKEY = 0x0312
ASSISTANT_PROCESS_NAME = "vorax-decision-assistant.exe"


@dataclass(frozen=True)
class ClientRegion:
    left: int
    top: int
    width: int
    height: int


class HotkeyRecognitionStore:
    """Stores exactly one newest global-hotkey recognition result for the web UI."""

    def __init__(self, recognizer: "GameRecognizer") -> None:
        self._recognizer = recognizer
        self._lock = threading.Lock()
        self._sequence = 0
        self._status = "idle"
        self._result: dict[str, Any] | None = None
        self._error: str | None = None
        self.session_id = uuid.uuid4().hex
        self.hotkey_registered = False
        self.hotkey_error: str | None = "F8 正在注册"
        self._started_at: float | None = None
        self._finished_at: float | None = None
        self._source = "none"
        self._events: list[dict[str, Any]] = []
        self.polling_active = False
        self.hook_active = False
        self.choices = ChoiceTracker()
        self.follow = FollowController(capture_follow_window, recognizer.recognize, self.publish_follow)
        self.follow.message = '单次识别模式 · 按 F8 截图一次'

    def toggle_follow(self, source='f8'):
        enabled = self.follow.toggle()
        self.trace('follow-toggle', source=source, enabled=enabled)
        return enabled

    def publish_follow(self, result, generation):
        with self._lock:
            self._sequence += 1
            self._source = 'continuous-follow'
            self._status = 'completed'
            self._error = None
            self._result = result
            self._finished_at = time.perf_counter()
            self._started_at = self._finished_at - result.get('diagnostics', {}).get('latencyMs', 0) / 1000
            self._follow_generation = generation

    def trace(self, event: str, **details: Any) -> None:
        entry = {"at": datetime.now(timezone.utc).isoformat(), "event": event, **details}
        with self._lock:
            self._events = [*self._events[-29:], entry]
        print("[capture] " + json.dumps(entry, ensure_ascii=False), flush=True)

    def trigger(self, source: str = "wm-hotkey") -> bool:
        if self.follow.enabled:
            self.follow.set_enabled(False)
        with self._lock:
            if self._status == "recognizing":
                return False
            self._sequence += 1
            self._status = "recognizing"
            self._started_at = time.perf_counter()
            self._finished_at = None
            self._source = source
            self._result = None
            self._error = None
        self.trace("request-start", source=source, sequence=self._sequence)
        choice_generation = self.choices.begin_capture()
        threading.Thread(target=self._recognize, args=(self.follow.generation, choice_generation), name="vorax-hotkey-recognition", daemon=True).start()
        return True

    def _recognize(self, generation=None, choice_generation=None) -> None:
        try:
            before = find_torchlight_window()
            result = self._recognizer.recognize(capture_torchlight_window(), "torchlight-" + self._source)
            after = find_torchlight_window()
            hwnd, region = after
            binding = (hwnd, region.left, region.top, region.width, region.height) if before == after else None
            self.choices.observe(result['snapshot'], binding, choice_generation)
            with self._lock:
                if generation is not None and generation != self.follow.generation:
                    if self._status == 'recognizing':
                        self._status = 'idle'
                    return
                self._finished_at = time.perf_counter()
                self._status = "completed"
                self._result = result
        except Exception as error:  # noqa: BLE001
            self.choices.invalidate('截图失败，选择未校验；请重新 F8')
            with self._lock:
                if generation is not None and generation != self.follow.generation:
                    if self._status == 'recognizing':
                        self._status = 'idle'
                    return
                self._finished_at = time.perf_counter()
                self._status = "failed"
                self._error = str(error)
        self.trace("request-end", status=self._status, error=self._error)

    def payload(self) -> dict[str, Any]:
        follow = self.follow.payload()
        choices = self.choices.payload()
        with self._lock:
            return {
                "choices": choices,
                "follow": follow,
                "followGeneration": getattr(self, '_follow_generation', None),
                "sequence": self._sequence,
                "sessionId": self.session_id,
                "hookActive": self.hook_active,
                "elapsedMs": round(((self._finished_at or time.perf_counter()) - self._started_at) * 1000) if self._started_at else 0,
                "triggerSource": self._source,
                "pollingActive": self.polling_active,
                "events": list(self._events),
                "hotkeyRegistered": self.hotkey_registered,
                "hotkeyError": self.hotkey_error,
                "status": self._status,
                "result": self._result,
                "error": self._error,
            }


class WinRect(ctypes.Structure):
    _fields_ = [
        ("left", ctypes.c_long),
        ("top", ctypes.c_long),
        ("right", ctypes.c_long),
        ("bottom", ctypes.c_long),
    ]


class WinPoint(ctypes.Structure):
    _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]


@dataclass(frozen=True)
class OcrLine:
    text: str
    confidence: float
    box: list[list[float]]

    @property
    def center_x(self) -> float:
        return sum(point[0] for point in self.box) / len(self.box)

    @property
    def center_y(self) -> float:
        return sum(point[1] for point in self.box) / len(self.box)


def pixel_region(region: tuple[float, float, float, float], width: int, height: int) -> tuple[int, int, int, int]:
    x, y, region_width, region_height = region
    return (
        round(x * width),
        round(y * height),
        round(region_width * width),
        round(region_height * height),
    )


def crop(image: np.ndarray, region: tuple[float, float, float, float]) -> tuple[np.ndarray, tuple[int, int]]:
    height, width = image.shape[:2]
    x, y, region_width, region_height = pixel_region(region, width, height)
    return image[y:y + region_height, x:x + region_width], (x, y)


def result_lines(result: Any, offset: tuple[int, int] = (0, 0)) -> list[OcrLine]:
    boxes = getattr(result, "boxes", None)
    texts = getattr(result, "txts", None)
    scores = getattr(result, "scores", None)

    if boxes is None and isinstance(result, (tuple, list)) and len(result) >= 2:
        raw = result[0] or []
        boxes = [item[0] for item in raw]
        texts = [item[1] for item in raw]
        scores = [item[2] for item in raw]

    if boxes is None or texts is None:
        return []

    x_offset, y_offset = offset
    score_values = scores if scores is not None else [0.0] * len(texts)
    lines: list[OcrLine] = []
    for box, text, score in zip(boxes, texts, score_values):
        if not text:
            continue
        shifted = [[float(point[0]) + x_offset, float(point[1]) + y_offset] for point in box]
        lines.append(OcrLine(str(text).strip(), float(score), shifted))
    return lines


def recognized(value: Any, confidence: float, region: tuple[float, float, float, float], width: int, height: int) -> dict[str, Any]:
    x, y, region_width, region_height = pixel_region(region, width, height)
    return {
        "value": value,
        "confidence": round(max(0.0, min(1.0, confidence)), 4),
        "sourceRegion": {"x": x, "y": y, "width": region_width, "height": region_height},
    }


def digits(text: str) -> list[int]:
    return [int(value) for value in re.findall(r"\d+", text.replace(",", ""))]


def first_number(lines: list[OcrLine], maximum: int | None = None) -> tuple[int, float] | None:
    candidates: list[tuple[int, float]] = []
    for line in lines:
        for value in digits(line.text):
            if maximum is None or value <= maximum:
                candidates.append((value, line.confidence))
    return candidates[0] if candidates else None


def normalized_text(text: str) -> str:
    return re.sub(r"[\s·,，。:：/|]", "", text)


class GameRecognizer:
    def __init__(self, fast_ocr: bool = True) -> None:
        self.fast_ocr = fast_ocr
        self._inference_lock = threading.Lock()
        self.engine = RapidOCR(params={
            "Global.use_cls": False,
            "Det.limit_type": "max",
            "Det.limit_side_len": 1280,
        } if fast_ocr else None)
        template_dir = Path(__file__).resolve().parent / "templates" / "monster-races"
        self.race_icon_templates = {
            race: [image for path in [template_dir / f"{race}.png", *sorted(template_dir.glob(f"{race}-*.png"))]
                   if (image := cv2.imread(str(path))) is not None]
            for race in ("construct", "awakened", "swarm", "aberrant")
        }

    def recognize_race_icon(
        self,
        image: np.ndarray,
        slot_index: int,
    ) -> tuple[str, float] | None:
        """Classify a slot by the coloured race icon, across 16:9 scales."""
        if not self.race_icon_templates:
            return None
        height, width = image.shape[:2]
        region = MONSTER_ICON_REGIONS[slot_index]
        icon_crop, _ = crop(image, region)
        if icon_crop.size == 0:
            return None

        # The supplied templates came from a 2560-pixel-wide client.  Test a
        # small scale band as window chrome and UI scaling can shift it a bit.
        scale_base = width / MONSTER_ICON_TEMPLATE_REFERENCE_WIDTH
        scores = {}
        for race, templates in self.race_icon_templates.items():
            best = -1.0
            for template in templates:
                for factor in (0.94, 1.0, 1.06):
                    scale = scale_base * factor
                    interpolation = cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC
                    resized = cv2.resize(template, None, fx=scale, fy=scale, interpolation=interpolation)
                    if resized.shape[0] > icon_crop.shape[0] or resized.shape[1] > icon_crop.shape[1]:
                        continue
                    score = float(cv2.minMaxLoc(
                        cv2.matchTemplate(icon_crop, resized, cv2.TM_CCOEFF_NORMED),
                    )[1])
                    best = max(best, score)
            scores[race] = best
        ranked = sorted(scores.items(), key=lambda item: item[1], reverse=True)
        best_race, best_score = ranked[0]
        if best_score < MONSTER_ICON_CONFIDENCE or best_score - ranked[1][1] < 0.08:
            return None
        return best_race, best_score

    @staticmethod
    def classify_name_color(name_crop: np.ndarray) -> tuple[str, float] | None:
        """Vote over bright text pixels, never infer rarity from the race icon."""
        if name_crop.size == 0:
            return None
        hsv = cv2.cvtColor(name_crop, cv2.COLOR_BGR2HSV)
        pixels = hsv[hsv[:, :, 2] >= 110]
        if len(pixels) < max(8, name_crop.shape[0] * name_crop.shape[1] * 0.025):
            return None
        hue, saturation = pixels[:, 0], pixels[:, 1]
        votes = {
            "common": np.count_nonzero(saturation <= 40),
            "magic": np.count_nonzero((saturation >= 65) & (hue >= 85) & (hue <= 130)),
            "rare": np.count_nonzero((saturation >= 65) & (hue >= 15) & (hue <= 40)),
            "boss": np.count_nonzero((saturation >= 90) & ((hue <= 10) | (hue >= 170))),
        }
        rarity = max(votes, key=votes.get)
        share = votes[rarity] / len(pixels)
        if share < 0.78:
            return None
        return rarity, min(0.98, share)

    @staticmethod
    def monster_name_line(lines: list[OcrLine], height: int) -> OcrLine | None:
        names = [line for line in lines
                 if 0.355 <= line.center_y / height <= 0.379
                 and re.search(r"[\u4e00-\u9fff]", line.text)
                 and not re.search(r"[0-9×]", line.text)]
        return names[0] if len(names) == 1 else None

    def retry_monster_name(self, image: np.ndarray, slot_index: int) -> OcrLine | None:
        """Retry a missed short name locally; caller must have numeric occupant evidence."""
        x, _, w, _ = MONSTER_SUMMARIES[slot_index]
        tile, (left, top) = crop(image, (x, .354, w, .018))
        if not tile.size:
            return None
        scale = 3
        enlarged = cv2.resize(tile, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
        lines = result_lines(self.engine(enlarged, use_det=True, use_cls=False))
        names = [line for line in lines if line.confidence >= .85
                 and re.fullmatch(r'[\u4e00-\u9fff]{2,24}', re.sub(r'\s+', '', line.text))]
        if len(names) != 1:
            return None
        line = names[0]
        return OcrLine(re.sub(r'\s+', '', line.text), line.confidence,
                       [[px / scale + left, py / scale + top] for px, py in line.box])

    def recognize_name_rarity(self, image: np.ndarray, lines: list[OcrLine]) -> dict[str, Any] | None:
        height, width = image.shape[:2]
        line = self.monster_name_line(lines, height)
        if line is None:
            return None
        left, top = np.min(line.box, axis=0)
        right, bottom = np.max(line.box, axis=0)
        # Trim OCR padding above/below glyphs, away from race/activity icons.
        inset = (bottom - top) * 0.15
        x1, y1 = max(0, int(left)), max(0, int(top + inset))
        x2, y2 = min(width, int(right)), min(height, int(bottom - inset))
        result = self.classify_name_color(image[y1:y2, x1:x2])
        if result is None:
            return None
        rarity, confidence = result
        return recognized(rarity, confidence * min(1.0, line.confidence / 0.85),
                          (x1 / width, y1 / height, (x2 - x1) / width, (y2 - y1) / height), width, height)

    @staticmethod
    def lines_in_region(
        lines: list[OcrLine],
        region: tuple[float, float, float, float],
        width: int,
        height: int,
    ) -> list[OcrLine]:
        x, y, region_width, region_height = pixel_region(region, width, height)
        return [
            line for line in lines
            if x <= line.center_x <= x + region_width and y <= line.center_y <= y + region_height
        ]

    def recognize(self, image: np.ndarray, source: str) -> dict[str, Any]:
        if not self._inference_lock.acquire(blocking=False):
            raise RuntimeError("正在识别上一张截图，请等待完成后再试")
        try:
            return self._recognize(image, source)
        finally:
            self._inference_lock.release()

    def _ocr_lines(self, image: np.ndarray) -> list[OcrLine]:
        if not self.fast_ocr:
            return result_lines(self.engine(image, use_det=True))
        # One packed inference, retaining original resolution and source coordinates.
        # Read HUD, monster summaries, selection heading and card titles, not artwork/body text.
        regions = [
            (0.025, 0.33, 0.10, 0.16),
            *MONSTER_SUMMARIES,
            (0.285, 0.62, 0.485, 0.075),
            (0.285, 0.72, 0.485, 0.12),
            (0.30, 0.87, 0.45, 0.055),  # Card type footers survive a raised card hiding the heading.
            (.61, .925, .06, .045),
        ]
        tiles = [crop(image, region) for region in regions]
        padding = 20
        canvas_width = max(tile.shape[1] for tile, _ in tiles) + padding * 2
        placements = []
        x = y = padding
        row_height = 0
        for tile, origin in tiles:
            height, width = tile.shape[:2]
            if x + width + padding > canvas_width:
                x = padding
                y += row_height + padding
                row_height = 0
            placements.append((tile, origin, x, y))
            x += width + padding
            row_height = max(row_height, height)
        canvas = np.zeros((y + row_height + padding, canvas_width, 3), dtype=np.uint8)
        for tile, _, x, y in placements:
            canvas[y:y + tile.shape[0], x:x + tile.shape[1]] = tile
        output = []
        for line in result_lines(self.engine(canvas, use_det=True)):
            for tile, (original_x, original_y), x, y in placements:
                if x <= line.center_x < x + tile.shape[1] and y <= line.center_y < y + tile.shape[0]:
                    output.append(OcrLine(line.text, line.confidence, [
                        [px - x + original_x, py - y + original_y] for px, py in line.box
                    ]))
                    break
        return output

    def _recognize(self, image: np.ndarray, source: str) -> dict[str, Any]:
        started = time.perf_counter()
        height, width = image.shape[:2]
        issues: list[str] = []

        all_lines = self._ocr_lines(image)
        ocr_ms = round((time.perf_counter() - started) * 1000, 1)
        round_lines = self.lines_in_region(all_lines, REGIONS["round"], width, height)
        final_lines = self.lines_in_region(all_lines, REGIONS["final_activity"], width, height)
        selection_lines = self.lines_in_region(all_lines, REGIONS["selection"], width, height)
        monster_lines = [
            self.lines_in_region(all_lines, region, width, height)
            for region in MONSTER_SUMMARIES
        ]

        round_value = None
        total_rounds = None
        round_confidence = 0.0
        round_text = " ".join(line.text for line in round_lines)
        round_match = re.search(r"(\d{1,2})\s*[/|]\s*(\d{1,2})", round_text)
        if not round_match:
            # Large round digits and the smaller '/13' may be split by the detector.
            # Recognize this one fixed line directly, without rerunning full detection.
            round_image, _ = crop(image, REGIONS["round"])
            direct = self.engine(round_image, use_det=False, use_cls=False)
            direct_text = " ".join(getattr(direct, "txts", None) or [])
            direct_match = re.fullmatch(r"(\d{1,2})\s*[/|]\s*(\d{1,2})", direct_text.strip())
            direct_scores = getattr(direct, "scores", None)
            if direct_match and direct_scores and min(direct_scores) >= 0.72:
                x, y, w, h = pixel_region(REGIONS["round"], width, height)
                round_lines = [OcrLine(direct_text, min(direct_scores), [[x,y],[x+w,y],[x+w,y+h],[x,y+h]])]
                round_match = direct_match
        if round_match:
            round_value = int(round_match.group(1))
            total_rounds = int(round_match.group(2))
            round_confidence = min((line.confidence for line in round_lines), default=0.0)
        else:
            values = [value for line in round_lines for value in digits(line.text) if value <= 99]
            if len(values) >= 2:
                round_value, total_rounds = values[:2]
                round_confidence = min((line.confidence for line in round_lines), default=0.0) * 0.85
            else:
                issues.append("未可靠识别回合数")

        final_result = first_number(final_lines)
        if final_result is None:
            issues.append("未可靠识别最终活性")

        monster_slots: list[dict[str, Any]] = []
        for index, (region, lines) in enumerate(zip(MONSTER_SUMMARIES, monster_lines), start=1):
            pair_line = next(
                (
                    line for line in lines
                    if re.search(r"\d+\s*[×xX]\s*\d+", line.text.replace(",", ""))
                ),
                None,
            )
            pair_match = (
                re.search(r"(\d+)\s*[×xX]\s*(\d+)", pair_line.text.replace(",", ""))
                if pair_line else None
            )
            name_line = self.monster_name_line(lines, height)
            if pair_match and (name_line is None or name_line.confidence < .85):
                retried = self.retry_monster_name(image, index - 1)
                if retried:
                    if name_line is not None:
                        lines.remove(name_line)
                    lines.append(retried)
                    all_lines.append(retried)
                    name_line = retried
            raw_name = re.sub(r"\s+", "", name_line.text) if name_line else None
            known_name = raw_name if raw_name in MONSTER_RACES else None
            confidence = max((line.confidence for line in lines), default=0.0)
            icon_result = self.recognize_race_icon(image, index - 1)
            # An unknown but legible monster name is still evidence of an
            # occupant; failing dictionary/icon lookup must not turn it empty.
            occupied = pair_match is not None or name_line is not None or icon_result is not None
            slot: dict[str, Any] = {
                "slotId": f"slot-{index}",
                "occupied": recognized(occupied, max(confidence, icon_result[1] if icon_result else 0) if occupied else 0.86, region, width, height),
            }
            if occupied and name_line:
                # Return unknown names too: the client owns the user's editable dictionary.
                slot["name"] = recognized(raw_name, name_line.confidence, region, width, height)
            if icon_result:
                icon_race, icon_confidence = icon_result
                slot["raceId"] = recognized(
                    icon_race,
                    icon_confidence,
                    MONSTER_ICON_REGIONS[index - 1],
                    width,
                    height,
                )
                if known_name and MONSTER_RACES[known_name] != icon_race:
                    issues.append(
                        f"槽位 {index} 名称推断为 {MONSTER_RACES[known_name]}，"
                        f"但图标识别为 {icon_race}；已优先采用图标"
                    )
            elif known_name:
                name_confidence = max((line.confidence for line in lines if known_name in line.text), default=confidence)
                slot["raceId"] = recognized(MONSTER_RACES[known_name], name_confidence * 0.95, region, width, height)
            if occupied:
                rarity = self.recognize_name_rarity(image, lines)
                if rarity:
                    slot["rarity"] = rarity
                # Missing visual attributes are reviewed after client-side name lookup.
            if pair_match:
                unit_activity = int(pair_match.group(1))
                quantity = int(pair_match.group(2))
                pair_confidence = pair_line.confidence if pair_line else confidence
                slot["unitActivity"] = recognized(unit_activity, pair_confidence, region, width, height)
                slot["quantity"] = recognized(quantity, pair_confidence, region, width, height)
                slot["displayedTotalActivity"] = recognized(unit_activity * quantity, pair_confidence * 0.96, region, width, height)
            monster_slots.append(slot)

        candidate_lines = self._candidate_title_lines(selection_lines, width, height)
        phase, phase_confidence, phase_issue = detect_phase(selection_lines, candidate_lines, width, height)
        if phase_issue:
            issues.append(phase_issue)
        candidate_names = [
            {"value": line.text, "confidence": line.confidence,
             "sourceRegion": {"x": min(p[0] for p in line.box), "y": min(p[1] for p in line.box),
                              "width": max(p[0] for p in line.box)-min(p[0] for p in line.box),
                              "height": max(p[1] for p in line.box)-min(p[1] for p in line.box)}}
            for line in candidate_lines
        ]
        if phase == "potionSelection" and len(candidate_names) >= 5:
            phase = "expandedPotionSelection"
        if not candidate_names:
            issues.append("未可靠识别候选卡名称")

        snapshot: dict[str, Any] = {
            "capturedAt": datetime.now(timezone.utc).isoformat(),
            "sourceImage": {"width": width, "height": height, "layoutProfileId": "normalized-16x9-v1"},
            "phase": recognized(phase, phase_confidence, REGIONS["selection"], width, height),
            "candidateCardIds": [],
            "candidateCardNames": candidate_names,
            "monsterSlots": monster_slots,
        }
        if round_value is not None:
            snapshot["round"] = recognized(round_value, round_confidence, REGIONS["round"], width, height)
        if total_rounds is not None:
            snapshot["totalRounds"] = recognized(total_rounds, round_confidence, REGIONS["round"], width, height)
        if final_result is not None:
            snapshot["displayedFinalActivity"] = recognized(final_result[0], final_result[1], REGIONS["final_activity"], width, height)
        reroll_lines = [line for line in all_lines
                        if .61*width <= line.center_x <= .67*width and .925*height <= line.center_y <= .97*height
                        and re.fullmatch(r'[0-3]', line.text.strip())]
        if phase in ('potionSelection', 'expandedPotionSelection') and len(reroll_lines) == 1:
            line = reroll_lines[0]
            snapshot['rerollsRemaining'] = recognized(int(line.text.strip()), line.confidence, (.61,.925,.06,.045), width, height)

        arithmetic_total = sum(
            slot.get("displayedTotalActivity", {}).get("value", 0)
            for slot in monster_slots
        )
        if final_result and arithmetic_total and final_result[0] != arithmetic_total:
            issues.append(f"槽位合计 {arithmetic_total} 与界面最终活性 {final_result[0]} 不一致")

        elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
        return {
            "snapshot": snapshot,
            "diagnostics": {
                "source": source,
                "latencyMs": elapsed_ms,
                "ocrMs": ocr_ms,
                "ocrMode": "packed-regions" if self.fast_ocr else "full-image",
                "issues": issues,
                "ocrLines": [
                    {"text": line.text, "confidence": round(line.confidence, 4), "center": [round(line.center_x, 1), round(line.center_y, 1)]}
                    for line in [*round_lines, *final_lines, *selection_lines, *(item for lines in monster_lines for item in lines)]
                ],
            },
        }

    @staticmethod
    def _candidate_title_lines(lines: list[OcrLine], width: int, height: int) -> list[OcrLine]:
        candidates = [
            line for line in lines
            if 0.72 <= line.center_y / height <= 0.84
            and 0.30 <= line.center_x / width <= 0.75
            and 2 <= len(normalized_text(line.text)) <= 14
            and not any(word in line.text for word in ("选择一种", "普通药剂", "魔法药剂", "稀有药剂", "手术用具", "数量"))
            and not re.search(r"[0-9+%×]", line.text)
        ]
        if not candidates:
            return []

        five_card_layout = min(line.center_x / width for line in candidates) < 0.40
        centers = [0.35, 0.44, 0.526, 0.61, 0.697] if five_card_layout else [0.466, 0.553, 0.639]
        output: list[OcrLine] = []
        for center in centers:
            nearby = [line for line in candidates if abs(line.center_x / width - center) <= 0.065]
            if nearby:
                output.append(min(nearby, key=lambda line: (line.center_y, -line.confidence)))
        return output


def decode_image(data: bytes) -> np.ndarray:
    encoded = np.frombuffer(data, dtype=np.uint8)
    image = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("无法解码上传的图片")
    return image


def process_image_name(process_id: int) -> str:
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    process_query_limited_information = 0x1000
    handle = kernel32.OpenProcess(process_query_limited_information, False, process_id)
    if not handle:
        return ""
    try:
        buffer = ctypes.create_unicode_buffer(32768)
        size = wintypes.DWORD(len(buffer))
        if not kernel32.QueryFullProcessImageNameW(handle, 0, buffer, ctypes.byref(size)):
            return ""
        return Path(buffer.value).name.casefold()
    finally:
        kernel32.CloseHandle(handle)


def find_torchlight_window() -> tuple[int, ClientRegion]:
    if sys.platform != "win32":
        raise RuntimeError("游戏窗口捕获仅支持 Windows")

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    matches: list[tuple[int, str]] = []
    enum_callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    @enum_callback_type
    def collect_window(hwnd: int, _: int) -> bool:
        if not user32.IsWindowVisible(hwnd) or user32.IsIconic(hwnd):
            return True
        title_length = user32.GetWindowTextLengthW(hwnd)
        if title_length <= 0:
            return True
        title_buffer = ctypes.create_unicode_buffer(title_length + 1)
        user32.GetWindowTextW(hwnd, title_buffer, len(title_buffer))
        title = title_buffer.value.strip()
        if title.casefold() != TORCHLIGHT_WINDOW_TITLE.casefold():
            return True
        process_id = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(process_id))
        if process_image_name(process_id.value) == TORCHLIGHT_PROCESS_NAME:
            matches.append((hwnd, title))
        return True

    if not user32.EnumWindows(collect_window, 0):
        raise RuntimeError("无法枚举 Windows 窗口")
    if not matches:
        raise RuntimeError(
            "未找到可见的 Torchlight: Infinite 游戏窗口；请确认游戏未最小化且已启动",
        )

    hwnd, _ = matches[0]
    rect = WinRect()
    if not user32.GetClientRect(hwnd, ctypes.byref(rect)):
        raise RuntimeError("无法读取游戏窗口客户区")
    origin = WinPoint(rect.left, rect.top)
    if not user32.ClientToScreen(hwnd, ctypes.byref(origin)):
        raise RuntimeError("无法换算游戏窗口客户区坐标")
    width = rect.right - rect.left
    height = rect.bottom - rect.top
    if width <= 0 or height <= 0:
        raise RuntimeError("游戏窗口客户区尺寸无效")
    return hwnd, ClientRegion(left=origin.x, top=origin.y, width=width, height=height)


def find_torchlight_client_region() -> ClientRegion:
    _, region = find_torchlight_window()
    return region


def require_torchlight_window_foreground(hwnd: int) -> None:
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    user32.GetForegroundWindow.restype = wintypes.HWND
    user32.IsIconic.argtypes = [wintypes.HWND]
    user32.IsWindowVisible.argtypes = [wintypes.HWND]
    if user32.GetForegroundWindow() != hwnd:
        raise RuntimeError(
            "决策器避让后游戏仍不在前台，请先切回 Torchlight: Infinite 再按 F8；不会捕获其他应用",
        )


def wait_for_game_foreground(user32, game_hwnd: int, assistant_windows: list[int]) -> None:
    # Only a request originating in our own UI may ask Windows to focus the game.
    # Never inject Alt, attach input queues, or steal focus from a third-party app.
    foreground = user32.GetForegroundWindow()
    if foreground in assistant_windows:
        user32.SetForegroundWindow(game_hwnd)
        for _ in range(15):
            foreground = user32.GetForegroundWindow()
            if foreground == game_hwnd:
                break
            if foreground not in [None, 0, *assistant_windows]:
                break
            time.sleep(0.02)
    require_torchlight_window_foreground(game_hwnd)


def is_assistant_event_target(user32, hwnd: int) -> bool:
    """Called only after ownership validation; Tao's event sink is not a UI overlay."""
    user32.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    name = ctypes.create_unicode_buffer(256)
    return bool(user32.GetClassNameW(hwnd, name, len(name))) and name.value == 'Tao Thread Event Target'


@contextmanager
def assistant_hidden_for_capture(game_hwnd: int):
    """Hide only our visible desktop windows for the grab, restore without activation."""
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    user32.GetForegroundWindow.restype = wintypes.HWND
    user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
    user32.SetForegroundWindow.argtypes = [wintypes.HWND]
    user32.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int,
                                  ctypes.c_int, ctypes.c_int, wintypes.UINT]
    user32.IsWindowVisible.argtypes = [wintypes.HWND]
    user32.IsIconic.argtypes = [wintypes.HWND]
    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    windows = []
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    @callback_type
    def collect(hwnd, _):
        if user32.IsWindowVisible(hwnd) and not user32.IsIconic(hwnd):
            process_id = wintypes.DWORD()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(process_id))
            if process_image_name(process_id.value) == ASSISTANT_PROCESS_NAME:
                if not is_assistant_event_target(user32, hwnd):
                    windows.append(hwnd)
        return True

    if not user32.EnumWindows(collect, 0):
        raise RuntimeError("无法枚举决策器窗口，已取消截图")
    foreground = user32.GetForegroundWindow()
    print(f"[capture-window] game={game_hwnd} foreground={foreground} overlays={windows}", flush=True)
    if foreground not in [game_hwnd, *windows]:
        raise RuntimeError("请先切回游戏或决策器浮窗再按 F8；不会捕获其他应用")
    hidden = []
    try:
        wait_for_game_foreground(user32, game_hwnd, windows)
        for hwnd in windows:
            hidden.append(hwnd)
            # Preserve activation, position, size and topmost state while hiding.
            if not user32.SetWindowPos(hwnd, None, 0, 0, 0, 0, 0x97):
                raise RuntimeError(f"决策器窗口避让失败（Win32 {ctypes.get_last_error()}）")
        if hidden:
            ctypes.WinDLL("dwmapi").DwmFlush()
            time.sleep(0.06)
        print(f"[capture-window] after-hide foreground={user32.GetForegroundWindow()}", flush=True)
        require_torchlight_window_foreground(game_hwnd)
        yield
    finally:
        for hwnd in reversed(hidden):
            user32.ShowWindow(hwnd, 8)  # SW_SHOWNA preserves size/maximization, no activation.


def capture_torchlight_window() -> np.ndarray:
    from mss import mss

    hwnd, region = find_torchlight_window()
    with assistant_hidden_for_capture(hwnd), mss() as capture:
        shot = np.asarray(capture.grab({
            "left": region.left,
            "top": region.top,
            "width": region.width,
            "height": region.height,
        }))
    return cv2.cvtColor(shot, cv2.COLOR_BGRA2BGR)


def capture_follow_window() -> np.ndarray:
    """No hiding/reactivation in the continuous path; excluded overlays stay visible."""
    from mss import mss
    hwnd, region = find_torchlight_window()
    user32 = ctypes.WinDLL('user32', use_last_error=True)
    user32.GetForegroundWindow.restype = wintypes.HWND
    user32.IsIconic.argtypes = [wintypes.HWND]
    user32.IsWindowVisible.argtypes = [wintypes.HWND]
    if user32.GetForegroundWindow() != hwnd or user32.IsIconic(hwnd):
        raise RuntimeError('等待游戏前台；切回 Torchlight 后自动继续')
    # Tauri enables WDA_EXCLUDEFROMCAPTURE only while following. Verify it, rather
    # than silently OCR-ing an overlaid calculator or repeatedly hiding the window.
    if sys.getwindowsversion().build < 19041:
        raise RuntimeError('此系统不支持无闪烁截图排除，请使用单次识别')
    user32.GetWindowDisplayAffinity.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    blocked = []
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    @callback_type
    def inspect(window, _):
        if user32.IsWindowVisible(window) and not user32.IsIconic(window):
            pid = wintypes.DWORD()
            user32.GetWindowThreadProcessId(window, ctypes.byref(pid))
            if process_image_name(pid.value) == ASSISTANT_PROCESS_NAME:
                if is_assistant_event_target(user32, window):
                    return True
                affinity = wintypes.DWORD()
                if not user32.GetWindowDisplayAffinity(window, ctypes.byref(affinity)) or affinity.value != 0x11:
                    blocked.append(window)
        return True
    if not user32.EnumWindows(inspect, 0):
        raise RuntimeError('无法校验浮窗截图排除，暂不采集')
    if blocked:
        raise RuntimeError('等待新版客户端开启截图排除；请保持客户端在线')
    require_torchlight_window_foreground(hwnd)
    with mss() as capture:
        shot = np.asarray(capture.grab({'left':region.left,'top':region.top,'width':region.width,'height':region.height}))
    require_torchlight_window_foreground(hwnd)
    return cv2.cvtColor(shot, cv2.COLOR_BGRA2BGR)


class F8Dispatcher:
    """Coalesce WM_HOTKEY and physical-down edges; never repeat a held key."""

    def __init__(self, store: HotkeyRecognitionStore):
        self.store = store
        self.down = False
        self.handled = False
        self.last_dispatch = float("-inf")

    def dispatch(self, source: str, now: float) -> None:
        if self.handled or now - self.last_dispatch < 0.35:
            self.store.trace("f8-duplicate", source=source)
            return
        self.handled = True
        self.last_dispatch = now
        accepted = self.store.trigger(source)
        self.store.trace("f8-event", source=source, accepted=accepted)

    def sample(self, down: bool, allowed: bool, now: float) -> None:
        if down and not self.down and allowed:
            self.dispatch("f8-poll", now)
        if not down:
            self.handled = False
        self.down = down


def foreground_process_name(user32) -> str:
    process_id = wintypes.DWORD()
    user32.GetWindowThreadProcessId(user32.GetForegroundWindow(), ctypes.byref(process_id))
    return process_image_name(process_id.value)


class F8HookBuffer:
    """Keep only F8 edges, never text/other keys; drain outside the OS callback."""

    def __init__(self, down=False):
        self.down = down
        self.events = deque(maxlen=16)

    def record(self, key, message, flags, foreground, modified, now):
        if key != HOTKEY_VK_F8 or flags & 0x10:  # Ignore injected events.
            return
        if message in (0x101, 0x105):
            self.down = False
        elif message in (0x100, 0x104):
            if not self.down and not modified:
                self.events.append((foreground, now))
            self.down = True


def install_f8_hook(user32, buffer):
    # Pointer-sized types are essential on 64-bit Windows. Callback only queues;
    # OCR, process lookup and logging stay outside the input hook.
    class KeyboardInput(ctypes.Structure):
        _fields_ = [("vkCode", wintypes.DWORD), ("scanCode", wintypes.DWORD),
                    ("flags", wintypes.DWORD), ("time", wintypes.DWORD),
                    ("dwExtraInfo", ctypes.c_size_t)]

    callback_type = ctypes.WINFUNCTYPE(ctypes.c_ssize_t, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM)
    user32.CallNextHookEx.argtypes = [wintypes.HANDLE, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM]
    user32.CallNextHookEx.restype = ctypes.c_ssize_t
    user32.SetWindowsHookExW.argtypes = [ctypes.c_int, callback_type, wintypes.HINSTANCE, wintypes.DWORD]
    user32.SetWindowsHookExW.restype = wintypes.HANDLE
    user32.UnhookWindowsHookEx.argtypes = [wintypes.HANDLE]
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.GetModuleHandleW.argtypes = [wintypes.LPCWSTR]
    kernel32.GetModuleHandleW.restype = wintypes.HMODULE

    @callback_type
    def callback(code, message, pointer):
        if code == 0:
            event = ctypes.cast(pointer, ctypes.POINTER(KeyboardInput)).contents
            if event.vkCode == HOTKEY_VK_F8:
                modified = any(user32.GetAsyncKeyState(key) & 0x8000
                               for key in (0x10, 0x11, 0x12, 0x5B, 0x5C))
                buffer.record(event.vkCode, message, event.flags, user32.GetForegroundWindow(),
                              modified, time.perf_counter())
        return user32.CallNextHookEx(None, code, message, pointer)

    handle = user32.SetWindowsHookExW(13, callback, kernel32.GetModuleHandleW(None), 0)
    return handle, callback  # Keep callback alive for the whole listener lifetime.


def run_global_hotkey(store: HotkeyRecognitionStore) -> None:
    """Listen for F8 without taking foreground focus away from the game."""
    if sys.platform != "win32":
        print("全局快捷键仅支持 Windows，已跳过注册")
        return

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    user32.GetForegroundWindow.restype = wintypes.HWND
    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user32.GetAsyncKeyState.argtypes = [ctypes.c_int]
    user32.GetAsyncKeyState.restype = ctypes.c_short
    user32.PeekMessageW.argtypes = [ctypes.POINTER(wintypes.MSG), wintypes.HWND,
                                  wintypes.UINT, wintypes.UINT, wintypes.UINT]
    if not user32.RegisterHotKey(None, HOTKEY_ID, HOTKEY_MOD_NOREPEAT, HOTKEY_VK_F8):
        error_code = ctypes.get_last_error()
        store.hotkey_error = f"F8 注册失败（Win32 {error_code}），可能被占用；可使用截图识别按钮"
        print(store.hotkey_error)
        return

    store.hotkey_registered = True
    store.hotkey_error = None
    store.polling_active = True
    print("全局快捷键已注册：F8（单次截图识别）")
    message = wintypes.MSG()
    dispatcher = F8Dispatcher(store)
    # Do not interpret F8 held while starting the service as a fresh press.
    dispatcher.down = bool(user32.GetAsyncKeyState(HOTKEY_VK_F8) & 0x8000)
    hook_buffer = F8HookBuffer(dispatcher.down)
    hook_handle = None
    try:
        hook_handle, hook_callback = install_f8_hook(user32, hook_buffer)
    except Exception as error:
        store.trace("f8-hook-error", error=str(error))
    store.hook_active = bool(hook_handle)
    store.trace("f8-hook-registration", active=store.hook_active,
                error=None if hook_handle else ctypes.get_last_error())
    try:
        while True:
            while user32.PeekMessageW(ctypes.byref(message), None, 0, 0, 1):
                if message.message == 0x0012:  # WM_QUIT
                    return
                if message.message == WM_HOTKEY and message.wParam == HOTKEY_ID:
                    store.trace("wm-hotkey", foreground=foreground_process_name(user32))
                    dispatcher.dispatch("wm-hotkey", time.perf_counter())
            while hook_buffer.events:
                foreground_hwnd, pressed_at = hook_buffer.events.popleft()
                process_id = wintypes.DWORD()
                user32.GetWindowThreadProcessId(foreground_hwnd, ctypes.byref(process_id))
                foreground = process_image_name(process_id.value)
                allowed = foreground in (TORCHLIGHT_PROCESS_NAME, ASSISTANT_PROCESS_NAME)
                store.trace("f8-hook", foreground=foreground, allowed=allowed)
                if allowed:
                    dispatcher.dispatch("f8-hook", pressed_at)
            down = bool(user32.GetAsyncKeyState(HOTKEY_VK_F8) & 0x8000)
            allowed = False
            if down and not dispatcher.down:
                foreground = foreground_process_name(user32)
                # Poll only F8 and modifiers, not general typing. Ignore modified F8.
                modified = any(user32.GetAsyncKeyState(key) & 0x8000
                               for key in (0x10, 0x11, 0x12, 0x5B, 0x5C))
                allowed = not modified and foreground in (TORCHLIGHT_PROCESS_NAME, ASSISTANT_PROCESS_NAME)
                store.trace("f8-down", foreground=foreground, allowed=allowed)
            dispatcher.sample(down, allowed, time.perf_counter())
            time.sleep(0.01)
    except Exception as error:
        store.trace("listener-error", error=str(error))
    finally:
        store.polling_active = False
        store.hook_active = False
        if hook_handle:
            user32.UnhookWindowsHookEx(hook_handle)
        store.hotkey_registered = False
        store.hotkey_error = "F8 监听已停止"
        user32.UnregisterHotKey(None, HOTKEY_ID)


class RecognitionHandler(BaseHTTPRequestHandler):
    recognizer: GameRecognizer
    hotkey_store: HotkeyRecognitionStore

    def _allowed_origin(self) -> str | None:
        origin = self.headers.get("Origin")
        if origin is None:
            return None
        # Vite runs on localhost during development, while the packaged Tauri
        # client is served from its own local WebView origin.  Both still talk
        # only to this loopback-only service.
        tauri_origins = {
            "tauri://localhost",
            "http://tauri.localhost",
            "https://tauri.localhost",
        }
        return origin if (
            origin in tauri_origins
            or re.fullmatch(r"http://(?:127\.0\.0\.1|localhost):\d+", origin)
        ) else ""

    def _send(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        allowed_origin = self._allowed_origin()
        if allowed_origin:
            self.send_header("Access-Control-Allow-Origin", allowed_origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        if self._allowed_origin() == "":
            self._send(403, {"error": "origin not allowed"})
            return
        self._send(204, {})

    def do_GET(self) -> None:
        if self._allowed_origin() == "":
            self._send(403, {"error": "origin not allowed"})
            return
        if self.path == "/health":
            self._send(200, {
                "ok": True,
                "service": "vorax-local-recognizer",
                "hotkey": "F8",
                "hotkeyRegistered": self.hotkey_store.hotkey_registered,
                "hotkeyError": self.hotkey_store.hotkey_error,
                "sessionId": self.hotkey_store.session_id,
                "apiVersion": 2,
                "runtimeVersion": "2026-09-06-phase-fallback-v1",
                "pollingActive": self.hotkey_store.polling_active,
            })
            return
        if self.path == "/hotkey-recognition":
            self.hotkey_store.follow.touch()
            self._send(200, self.hotkey_store.payload())
            return
        self._send(404, {"error": "not found"})

    def do_POST(self) -> None:
        if self._allowed_origin() == "":
            self._send(403, {"error": "origin not allowed"})
            return
        if self.path in ('/choices/reset', '/choices/enable', '/choices/disable'):
            enabled = True if self.path.endswith('/enable') else False if self.path.endswith('/disable') else None
            self.hotkey_store.choices.reset(enabled)
            self._send(200, self.hotkey_store.choices.payload())
            return
        if self.path in ('/follow/start', '/follow/pause'):
            if self.path.endswith('/start'):
                self._send(409, {'error': '已恢复单次识别，请按 F8 或点击识别屏幕'})
                return
            self.hotkey_store.follow.set_enabled(False)
            self._send(200, self.hotkey_store.payload())
            return
        if self.path == "/trigger-capture":
            accepted = self.hotkey_store.trigger("capture-button")
            self._send(202, {"accepted": accepted, **self.hotkey_store.payload()})
            return
        if self.path == "/capture-recognize":
            try:
                self._send(200, self.recognizer.recognize(capture_torchlight_window(), "torchlight-window"))
            except Exception as error:  # noqa: BLE001
                self._send(500, {"error": str(error)})
            return
        if self.path != "/recognize":
            self._send(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 25 * 1024 * 1024:
                raise ValueError("图片为空或超过 25 MB")
            image = decode_image(self.rfile.read(length))
            self._send(200, self.recognizer.recognize(image, "uploaded-image"))
        except Exception as error:  # noqa: BLE001
            self._send(400, {"error": str(error)})

    def log_message(self, format: str, *args: Any) -> None:
        if self.path == "/hotkey-recognition":
            return
        self.hotkey_store.choices.invalidate('导入图片不监听游戏点击；请 F8 读取实时牌面')
        sys.stdout.write(f"[recognizer] {self.address_string()} {format % args}\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="渴瘾决策器本地屏幕识别服务")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=28765)
    parser.add_argument("--image", type=Path, help="识别单张图片并输出 JSON，不启动服务")
    args = parser.parse_args()

    recognizer = GameRecognizer()
    if args.image:
        image = cv2.imread(str(args.image))
        if image is None:
            raise SystemExit(f"无法读取图片：{args.image}")
        print(json.dumps(recognizer.recognize(image, str(args.image)), ensure_ascii=False, indent=2))
        return

    RecognitionHandler.recognizer = recognizer
    RecognitionHandler.hotkey_store = HotkeyRecognitionStore(recognizer)
    # Continuous observation is disabled; only explicit screenshot requests run OCR.
    server = ThreadingHTTPServer((args.host, args.port), RecognitionHandler)
    print(f"渴瘾屏幕识别服务：http://{args.host}:{args.port}")
    print("保持本窗口运行；每按一次 F8 截图识别一次，不自动循环采集。")
    threading.Thread(
        target=run_global_hotkey,
        args=(RecognitionHandler.hotkey_store,),
        name="vorax-global-hotkey",
        daemon=True,
    ).start()
    threading.Thread(target=run_mouse_listener, args=(RecognitionHandler.hotkey_store.choices, find_torchlight_window),
                     name='vorax-game-choice-listener', daemon=True).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

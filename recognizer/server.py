from __future__ import annotations

import argparse
import ctypes
import json
import re
import sys
import threading
import time
from ctypes import wintypes
from dataclasses import dataclass
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from rapidocr import RapidOCR


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

    def trigger(self) -> None:
        with self._lock:
            if self._status == "recognizing":
                return
            self._status = "recognizing"
            self._result = None
            self._error = None
        threading.Thread(target=self._recognize, name="vorax-hotkey-recognition", daemon=True).start()

    def _recognize(self) -> None:
        try:
            result = self._recognizer.recognize(capture_torchlight_window(), "torchlight-hotkey-f8")
            with self._lock:
                self._sequence += 1
                self._status = "completed"
                self._result = result
        except Exception as error:  # noqa: BLE001
            with self._lock:
                self._sequence += 1
                self._status = "failed"
                self._error = str(error)

    def payload(self) -> dict[str, Any]:
        with self._lock:
            return {
                "sequence": self._sequence,
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
    def __init__(self) -> None:
        self.engine = RapidOCR()

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
        started = time.perf_counter()
        height, width = image.shape[:2]
        issues: list[str] = []

        # 单次全图推理后按固定区域筛选，避免对 9 个小区域重复运行检测模型。
        all_lines = result_lines(self.engine(image))
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
            joined = " ".join(line.text for line in lines)
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
            known_name = next((name for name in MONSTER_RACES if name in joined), None)
            confidence = max((line.confidence for line in lines), default=0.0)
            occupied = pair_match is not None or known_name is not None
            slot: dict[str, Any] = {
                "slotId": f"slot-{index}",
                "occupied": recognized(occupied, confidence if occupied else 0.86, region, width, height),
            }
            if known_name:
                name_confidence = max((line.confidence for line in lines if known_name in line.text), default=confidence)
                slot["name"] = recognized(known_name, name_confidence, region, width, height)
                slot["raceId"] = recognized(MONSTER_RACES[known_name], name_confidence * 0.95, region, width, height)
            if pair_match:
                unit_activity = int(pair_match.group(1))
                quantity = int(pair_match.group(2))
                pair_confidence = pair_line.confidence if pair_line else confidence
                slot["unitActivity"] = recognized(unit_activity, pair_confidence, region, width, height)
                slot["quantity"] = recognized(quantity, pair_confidence, region, width, height)
                slot["displayedTotalActivity"] = recognized(unit_activity * quantity, pair_confidence * 0.96, region, width, height)
            monster_slots.append(slot)

        selection_text = " ".join(line.text for line in selection_lines)
        phase = "unknown"
        for word, phase_id in PHASE_WORDS:
            if word in selection_text:
                phase = phase_id
                break

        candidate_lines = self._candidate_title_lines(selection_lines, width, height)
        candidate_names = [
            recognized(line.text, line.confidence, REGIONS["selection"], width, height)
            for line in candidate_lines
        ]
        if phase == "potionSelection" and len(candidate_names) >= 5:
            phase = "expandedPotionSelection"
        if not candidate_names:
            issues.append("未可靠识别候选卡名称")

        snapshot: dict[str, Any] = {
            "capturedAt": datetime.now(timezone.utc).isoformat(),
            "sourceImage": {"width": width, "height": height, "layoutProfileId": "normalized-16x9-v1"},
            "phase": recognized(phase, 0.9 if phase != "unknown" else 0.2, REGIONS["selection"], width, height),
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
            and not any(word in line.text for word in ("选择一种", "普通药剂", "魔法药剂", "稀有药剂", "手术用具", "数量", "活性"))
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
    if user32.GetForegroundWindow() != hwnd:
        raise RuntimeError(
            "Torchlight: Infinite 当前不在前台；网页会遮住游戏，请改用“导入截图”。"
            "或切回游戏后按 F8 直接捕获",
        )


def capture_torchlight_window() -> np.ndarray:
    from mss import mss

    hwnd, region = find_torchlight_window()
    require_torchlight_window_foreground(hwnd)
    with mss() as capture:
        shot = np.asarray(capture.grab({
            "left": region.left,
            "top": region.top,
            "width": region.width,
            "height": region.height,
        }))
    return cv2.cvtColor(shot, cv2.COLOR_BGRA2BGR)


def run_global_hotkey(store: HotkeyRecognitionStore) -> None:
    """Listen for F8 without taking foreground focus away from the game."""
    if sys.platform != "win32":
        print("全局快捷键仅支持 Windows，已跳过注册")
        return

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    if not user32.RegisterHotKey(None, HOTKEY_ID, HOTKEY_MOD_NOREPEAT, HOTKEY_VK_F8):
        error_code = ctypes.get_last_error()
        print(f"无法注册全局快捷键 F8（Win32 错误 {error_code}）；可能已被其他程序占用")
        return

    print("全局快捷键已注册：F8（游戏保持前台时按下即可识别）")
    message = wintypes.MSG()
    try:
        while user32.GetMessageW(ctypes.byref(message), None, 0, 0) > 0:
            if message.message == WM_HOTKEY and message.wParam == HOTKEY_ID:
                store.trigger()
    finally:
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
            })
            return
        if self.path == "/hotkey-recognition":
            self._send(200, self.hotkey_store.payload())
            return
        self._send(404, {"error": "not found"})

    def do_POST(self) -> None:
        if self._allowed_origin() == "":
            self._send(403, {"error": "origin not allowed"})
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
    server = ThreadingHTTPServer((args.host, args.port), RecognitionHandler)
    print(f"渴瘾屏幕识别服务：http://{args.host}:{args.port}")
    print("保持本窗口运行；游戏前台按 F8 可截图识别，网页会自动读取结果。")
    threading.Thread(
        target=run_global_hotkey,
        args=(RecognitionHandler.hotkey_store,),
        name="vorax-global-hotkey",
        daemon=True,
    ).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

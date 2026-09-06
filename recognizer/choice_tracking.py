"""One screenshot -> one passive choice observation. Never drives game input/OCR."""
from copy import deepcopy
import threading
import time
import uuid


def value(snapshot, field):
    item = snapshot.get(field) or {}
    return item.get('value') if item.get('confidence', 0) >= .85 else None


def offer_key(snapshot):
    names = snapshot.get('candidateCardNames', [])
    if len(names) not in (3, 5) or any(n.get('confidence', 0) < .85 for n in names):
        return None
    phase, round_number = value(snapshot, 'phase'), value(snapshot, 'round')
    if phase not in ('surgeryRewardSelection', 'potionSelection', 'expandedPotionSelection') or not isinstance(round_number, int):
        return None
    return (round_number, phase, tuple(n['value'] for n in names))


class ChoiceTracker:
    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self.lock = threading.RLock()
        self.lease = 0
        self.enabled = True
        self.hook_active = False
        self.context = None
        self.pending = None
        self.records = []
        self.message = '按 F8 读取牌面后，监听一次选牌；不自动截图'
        self.suspended = False
        self.generation = 0

    def payload(self):
        with self.lock:
            if self.context and (self.clock()-self.lease >= 15 or self.clock()-self.context['at'] >= 120):
                self.invalidate('监听已超时或客户端断联，请重新 F8；未确认选择请人工记录')
            self.lease = self.clock()
            return deepcopy(dict(enabled=self.enabled, hookActive=self.hook_active,
                                 message=self.message, pending=self.pending, records=self.records))

    def reset(self, enabled=None):
        with self.lock:
            self.generation += 1
            if enabled is not None:
                self.enabled = enabled
            self.context = self.pending = None
            self.records = []
            self.message = '按 F8 重新读取牌面' if self.enabled else '选牌监听已关闭'

    def begin_capture(self):
        with self.lock:
            self.suspended = True
            return self.generation

    def invalidate(self, reason):
        with self.lock:
            if self.pending:
                self.pending['status'] = 'uncertain'
                self.pending['reason'] = reason
                self.records = [*self.records[-99:], self.pending]
            self.context = self.pending = None
            self.message = reason

    def observe(self, snapshot, binding=None, generation=None):
        with self.lock:
            if generation is not None and generation != self.generation:
                return
            self.suspended = False
            key = offer_key(snapshot)
            if self.pending:
                old = self.context
                transition = (key and old and binding == old['binding'] and key != old['key'] and
                              old['key'][0] <= key[0] <= old['key'][0] + 1 and
                              self.clock() - self.pending['clickedAt'] <= 120)
                confirmed = self.pending['status'] == 'confirm-clicked' and transition
                # A reroll also changes offers: a permanent requires leaving its stage.
                if self.pending['phase'] == 'surgeryRewardSelection':
                    confirmed = confirmed and key[1] != 'surgeryRewardSelection'
                self.pending['status'] = 'transition-observed' if confirmed else 'uncertain'
                self.pending['reason'] = '确认点击 + 后续画面变化；非游戏内部回执' if confirmed else '未同时取得确认点击与可靠后续变化，请人工核对'
                self.records = [*self.records[-99:], self.pending]
            self.pending = self.context = None
            regions = [n.get('sourceRegion') for n in snapshot.get('candidateCardNames', [])]
            if not self.enabled or not binding or not key or not all(regions):
                self.message = '本次牌面不适合监听；请手动记录或重新 F8'
                return
            width, height = snapshot['sourceImage']['width'], snapshot['sourceImage']['height']
            if width <= 0 or height <= 0 or not 1.7 <= width/height <= 1.9 or binding[3:] != (width, height):
                self.message = '窗口比例或截图尺寸不匹配，未开启监听'
                return
            centers = [(r['x'] + r['width']/2)/width for r in regions]
            if (centers != sorted(centers) or any(not .30 <= x <= .75 for x in centers)
                    or any(b-a < .035 for a,b in zip(centers, centers[1:]))):
                self.message = '候选位置不可靠，未开启监听'
                return
            # Narrow card interiors, anchored to actual OCR title centers; exclude overlap edges.
            boxes = []
            for i, x in enumerate(centers):
                gap = min([.09] + [abs(x-other) for j,other in enumerate(centers) if j != i])
                boxes.append((x-gap*.38, .72, gap*.76, .18))
            self.context = dict(key=key, binding=binding, boxes=boxes, at=self.clock())
            self.message = '游戏内点牌 → 点确认 → 下次 F8 校验；仅监听当前这手牌'

    def accepts(self, hwnd):
        return bool(self.enabled and not self.suspended and self.context and
                    self.clock()-self.lease < 15 and self.clock()-self.context['at'] < 120 and
                    hwnd == self.context['binding'][0])

    def click(self, x, y, binding):
        with self.lock:
            if not self.accepts(binding[0]):
                return
            if binding != self.context['binding']:
                self.invalidate('游戏窗口位置或尺寸变化，请重新 F8')
                return
            if self.pending and self.pending['status'] == 'confirm-clicked':
                return
            # Confirm/refresh interiors derived from the checked game layout, not desktop coordinates.
            if .60 <= x <= .665 and .932 <= y <= .97:
                self.invalidate('检测到洗牌点击，旧候选失效；请 F8 读取新牌')
                return
            if .515 <= x <= .59 and .933 <= y <= .965:
                if self.pending:
                    self.pending['status'] = 'confirm-clicked'
                    self.message = '已点确认，等待下次 F8 校验；未改动怪物数值'
                return
            for i, (left, top, width, height) in enumerate(self.context['boxes']):
                if left <= x <= left+width and top <= y <= top+height:
                    self.pending = dict(id=uuid.uuid4().hex, round=self.context['key'][0],
                                        phase=self.context['key'][1], name=self.context['key'][2][i],
                                        cardIndex=i, status='selected', targetSlots=[], clickedAt=self.clock())
                    self.message = f'暂选：{self.pending["name"]}；等待游戏确认'
                    return
            if self.pending and .15 <= y <= .425:
                for i, center in enumerate((.221,.357,.494,.630,.767,.903), 1):
                    if abs(x-center) < .047:
                        slots = self.pending['targetSlots']
                        self.pending['targetSlots'] = [s for s in slots if s != i] if i in slots else [*slots,i]
                        return


def run_mouse_listener(tracker, find_window):
    """Callbacks queue only physical left-up inside the armed foreground game."""
    import ctypes
    from ctypes import wintypes
    from collections import deque
    user32 = ctypes.WinDLL('user32', use_last_error=True)
    kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
    user32.GetForegroundWindow.restype = wintypes.HWND
    user32.GetAncestor.argtypes = [wintypes.HWND, wintypes.UINT]
    user32.GetAncestor.restype = wintypes.HWND
    user32.WindowFromPoint.argtypes = [wintypes.POINT]
    user32.WindowFromPoint.restype = wintypes.HWND
    callback_type = ctypes.WINFUNCTYPE(ctypes.c_ssize_t, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM)
    user32.CallNextHookEx.argtypes = [wintypes.HANDLE, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM]
    user32.CallNextHookEx.restype = ctypes.c_ssize_t
    user32.SetWindowsHookExW.argtypes = [ctypes.c_int, callback_type, wintypes.HINSTANCE, wintypes.DWORD]
    user32.SetWindowsHookExW.restype = wintypes.HANDLE
    user32.UnhookWindowsHookEx.argtypes = [wintypes.HANDLE]
    kernel32.GetModuleHandleW.argtypes = [wintypes.LPCWSTR]
    kernel32.GetModuleHandleW.restype = wintypes.HMODULE
    class MouseInput(ctypes.Structure):
        _fields_ = [('pt', wintypes.POINT), ('mouseData', wintypes.DWORD), ('flags', wintypes.DWORD),
                    ('time', wintypes.DWORD), ('dwExtraInfo', ctypes.c_size_t)]
    events = deque(maxlen=32)
    @callback_type
    def callback(code, message, pointer):
        try:
            if code == 0 and message == 0x202:  # WM_LBUTTONUP, not moves/typing
                hwnd = user32.GetForegroundWindow()
                if tracker.accepts(hwnd):
                    event = ctypes.cast(pointer, ctypes.POINTER(MouseInput)).contents
                    if not event.flags & 1 and user32.GetAncestor(user32.WindowFromPoint(event.pt), 2) == hwnd:
                        events.append((hwnd, event.pt.x, event.pt.y, tracker.context))
        except Exception:
            pass  # A concurrently invalidated context must never interrupt game input.
        return user32.CallNextHookEx(None, code, message, pointer)
    handle = user32.SetWindowsHookExW(14, callback, kernel32.GetModuleHandleW(None), 0)
    tracker.hook_active = bool(handle)
    if not handle:
        tracker.message = f'选牌监听注册失败（{ctypes.get_last_error()}），请手动记录'
        return
    message = wintypes.MSG()
    try:
        while True:
            while user32.PeekMessageW(ctypes.byref(message), None, 0, 0, 1):
                if message.message == 0x12:
                    return
            while events:
                hwnd, x, y, context = events.popleft()
                if context is not tracker.context:
                    continue
                try:
                    current, region = find_window()
                    if hwnd != current or user32.GetForegroundWindow() != hwnd:
                        tracker.invalidate('点击后窗口失焦，请重新 F8 或手动记录')
                        continue
                    binding = (current, region.left, region.top, region.width, region.height)
                    tracker.click((x-region.left)/region.width, (y-region.top)/region.height, binding)
                except Exception:
                    tracker.invalidate('无法校验游戏窗口，请重新 F8')
            time.sleep(.01)
    finally:
        tracker.hook_active = False
        user32.UnhookWindowsHookEx(handle)

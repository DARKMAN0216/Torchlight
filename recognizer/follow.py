"""Opt-in, foreground-only observation. No key injection, disk frames, or game reads."""
import copy
import json
import threading
import time

import cv2
import numpy as np


def visual_key(image):
    # Text/HUD, not animated monsters or the large moving card illustrations.
    regions = [(0.04, .348, .07, .065), (.039, .439, .073, .041),
               (.30, .642, .47, .033), (.29, .765, .49, .16), (.61, .929, .06, .04)]
    # Exclude the race icon and animated tube margin above the name.
    regions += [(x, .354, .112, .05) for x in [.165, .301, .438, .574, .711, .847]]
    h, w = image.shape[:2]
    patches = []
    for x, y, rw, rh in regions:
        patch = image[int(y*h):int((y+rh)*h), int(x*w):int((x+rw)*w)]
        gray = cv2.cvtColor(cv2.resize(patch, (192, 48)), cv2.COLOR_BGR2GRAY)
        patches.append(cv2.Canny(gray, 70, 150) > 0)
    return np.stack(patches)


def same_visual(a, b):
    return a is not None and b is not None and a.shape == b.shape and float(np.max(np.mean(a != b, axis=(1, 2)))) < .012


def value(item):
    return item.get('value') if isinstance(item, dict) else None


def confident(item, threshold=.8):
    return isinstance(item, dict) and item.get('confidence', 0) >= threshold


def stable_snapshot_key(snapshot, name_first=True):
    """Exclude confidence jitter/timing but include every state-bearing observation."""
    return json.dumps({
        'round': value(snapshot.get('round')), 'phase': value(snapshot.get('phase')),
        'total': value(snapshot.get('displayedFinalActivity')),
        'rerolls': value(snapshot.get('rerollsRemaining')),
        'cards': [value(x) for x in snapshot.get('candidateCardNames', [])],
        'slots': [dict(slotId=s.get('slotId'), **{
            k: value(s.get(k)) for k in ('occupied','name','raceId','rarity','quantity','unitActivity')
            if not (name_first and confident(s.get('name'), .85) and value(s.get('name'))
                    and k in ('raceId','rarity'))})
                  for s in sorted(snapshot.get('monsterSlots', []), key=lambda s:s.get('slotId',''))],
    }, ensure_ascii=False, sort_keys=True)


def snapshot_issue(snapshot):
    phase = snapshot.get('phase', {})
    if not confident(phase) or value(phase) not in ('potionSelection','expandedPotionSelection','surgeryRewardSelection','surgeryPlanSelection'):
        return '未可靠识别选牌阶段'
    if not confident(snapshot.get('round')) or not 1 <= value(snapshot['round']) <= 13:
        return '回合数未可靠识别'
    cards = snapshot.get('candidateCardNames', [])
    if len(cards) not in (3,5) or any(not confident(c, .72) for c in cards):
        return '候选牌未完整识别（需要 3 或 5 张可信名称）'
    slots = snapshot.get('monsterSlots', [])
    if len(slots) != 6 or {s.get('slotId') for s in slots} != {f'slot-{i}' for i in range(1,7)}:
        return '六个怪物槽位记录不完整'
    total = 0
    for slot in slots:
        if not confident(slot.get('occupied')):
            return f"{slot.get('slotId')} 是否有怪物尚不可靠"
        if not value(slot['occupied']):
            if any(value(slot.get(k)) for k in ('name','quantity','unitActivity')):
                return f"{slot.get('slotId')} 空槽与名称/数值矛盾"
            continue
        for key in ('quantity','unitActivity'):
            item = slot.get(key)
            if not confident(item) or not isinstance(value(item), int) or value(item) <= 0:
                label = '数量' if key == 'quantity' else '单体活性'
                return f"{slot.get('slotId')} {label}未可靠识别"
        total += value(slot['quantity']) * value(slot['unitActivity'])
    # A missing HUD must not erase monsters during an animation.
    hud = snapshot.get('displayedFinalActivity')
    if not confident(hud):
        return '画面总活性未可靠识别'
    return None if value(hud) == total else f'各槽合计 {total} 与画面总活性 {value(hud)} 不一致'


def complete_snapshot(snapshot):
    return snapshot_issue(snapshot) is None


def confirmation_difference(previous, current):
    a, b = json.loads(previous), json.loads(current)
    labels = {'round':'回合', 'phase':'阶段', 'total':'总活性', 'rerolls':'洗牌次数', 'cards':'候选牌'}
    for key, label in labels.items():
        if a[key] != b[key]:
            return f'连续两次{label}不同'
    for first, second in zip(a['slots'], b['slots']):
        if first != second:
            fields = {'occupied':'占用情况', 'name':'名称', 'raceId':'种群图标',
                      'rarity':'稀有度', 'quantity':'数量', 'unitActivity':'单体活性'}
            changed = '、'.join(label for key, label in fields.items() if first.get(key) != second.get(key))
            return f"连续两次 {second.get('slotId')} {changed or '槽位位置'}不同"
    return '连续两次局面不同'


def confirmed_result(previous, result):
    """Do not expose unstable visual fallback as confirmed evidence for unknown names."""
    output = copy.deepcopy(result)
    before = {s['slotId']:s for s in previous['monsterSlots']}
    for slot in output['snapshot']['monsterSlots']:
        if confident(slot.get('name'), .85) and value(slot.get('name')):
            for key in ('raceId','rarity'):
                old = before.get(slot['slotId'], {}).get(key)
                current = slot.get(key)
                if not confident(old, .72) or not confident(current, .72) or value(old) != value(current):
                    slot.pop(key, None)
    return output


class FollowController:
    def __init__(self, capture, recognize, publish, clock=time.monotonic):
        self.capture, self.recognize, self.publish, self.clock = capture, recognize, publish, clock
        self.lock = threading.RLock()
        self.enabled = False
        self.generation = 0
        self.status, self.message = 'paused', 'F8 开启持续跟随'
        self.last_client = clock()
        self.reset()

    def reset(self):
        self.previous = self.confirmed_visual = None
        self.stable_since = None
        self.pending_key = None
        self.pending_snapshot = None
        self.last_key = None
        self.last_payload_key = None
        self.last_check = 0
        self.retry_count = 0
        self.next_attempt = 0
        self.last_reason = ''
        self.ocr_count = 0

    def touch(self):
        with self.lock:
            self.last_client = self.clock()

    def set_enabled(self, enabled):
        with self.lock:
            self.enabled = enabled
            self.generation += 1
            self.reset()
            self.last_client = self.clock()
            self.status = 'settling' if enabled else 'paused'
            self.message = '正在等待游戏稳定画面' if enabled else '已暂停持续跟随'
            return self.enabled

    def toggle(self):
        with self.lock:
            return self.set_enabled(not self.enabled)

    def refresh(self):
        with self.lock:
            self.generation += 1
            self.reset()
            self.status, self.message = 'settling', '已请求重新同步'

    def payload(self):
        with self.lock:
            return {'enabled': self.enabled, 'generation': self.generation, 'status': self.status, 'message': self.message,
                    'retryCount': self.retry_count, 'retryAfterMs': max(0, round((self.next_attempt-self.clock())*1000)),
                    'lastReason': self.last_reason, 'ocrCount': self.ocr_count}

    def retry(self, reason, status='settling'):
        self.retry_count += 1
        delay = min(8, 2 ** min(self.retry_count - 1, 3))
        self.next_attempt = self.clock() + delay
        self.last_reason = reason
        self.status, self.message = status, f'{reason}；{delay} 秒后重试（连续 {self.retry_count} 次）'

    def tick(self):
        with self.lock:
            if not self.enabled:
                return
            if self.clock() - self.last_client > 15:
                self.set_enabled(False)
                self.message = '客户端已离线，持续跟随已自动暂停'
                return
            generation = self.generation
            if self.status == 'waiting' and self.clock() < self.next_attempt:
                return
        try:
            image = self.capture()  # Must refuse foreign foreground before grabbing.
            key = visual_key(image)
            now = self.clock()
            with self.lock:
                if not self.enabled or generation != self.generation:
                    return
                if not same_visual(self.previous, key):
                    self.previous, self.stable_since, self.pending_key = key, now, None
                    self.pending_snapshot = None
                    self.confirmed_visual = None
                    self.status, self.message = 'settling', '画面变化，等待结算稳定'
                    return
                if now - self.stable_since < .65:
                    return
                if now < self.next_attempt:
                    return
                if same_visual(self.confirmed_visual, key) and now - self.last_check < 8:
                    self.status, self.message = 'following', '持续跟随中 · 画面未变化'
                    return
                background = self.last_key is not None and same_visual(self.confirmed_visual, key)
                self.status = 'checking' if background else 'recognizing'
                self.message = '后台复查中，保留已确认推荐' if background else '正在核对稳定局面'
                self.ocr_count += 1
            result = self.recognize(image, 'continuous-follow')
            after = visual_key(self.capture())
            with self.lock:
                if not self.enabled or generation != self.generation:
                    return  # Paused/restarted during OCR: never publish late results.
                if not same_visual(key, after):
                    self.previous, self.stable_since, self.pending_key = after, self.clock(), None
                    self.pending_snapshot = self.confirmed_visual = None
                    self.retry('识别期间画面变化，等待下一次稳定')
                    return
                snapshot = result['snapshot']
                issue = snapshot_issue(snapshot)
                if issue:
                    self.pending_key = None
                    self.pending_snapshot = self.confirmed_visual = None
                    self.retry(issue)
                    return
                semantic = stable_snapshot_key(snapshot)
                if background and semantic == self.last_key:
                    # Stable names don't block confirmation. Unknown-name visual
                    # fallback is only retained when corroborated across observations.
                    output = confirmed_result(self.pending_snapshot, result)
                    payload_key = stable_snapshot_key(output['snapshot'], name_first=False)
                    if payload_key != self.last_payload_key:
                        self.publish(output, generation)
                        self.last_payload_key = payload_key
                    self.pending_snapshot = copy.deepcopy(snapshot)
                    self.last_check = self.clock()
                    self.retry_count, self.next_attempt, self.last_reason = 0, 0, ''
                    self.status, self.message = 'following', '后台复查完成 · 局面未变化'
                    return
                if self.pending_key != semantic:
                    previous = self.pending_key
                    self.pending_key = semantic
                    self.pending_snapshot = copy.deepcopy(snapshot)
                    self.confirmed_visual = None
                    if previous is not None:
                        self.retry(confirmation_difference(previous, semantic))
                    else:
                        self.status, self.message = 'settling', '正在进行第二次一致性确认'
                    return
                result = confirmed_result(self.pending_snapshot, result)
                self.pending_snapshot = copy.deepcopy(snapshot)
                self.confirmed_visual, self.last_check = after, self.clock()
                payload_key = stable_snapshot_key(result['snapshot'], name_first=False)
                if semantic != self.last_key or payload_key != self.last_payload_key:
                    self.publish(result, generation)
                    self.last_key = semantic
                    self.last_payload_key = payload_key
                self.retry_count, self.next_attempt, self.last_reason = 0, 0, ''
                self.status, self.message = 'following', '持续跟随中 · 局面已同步'
        except Exception as error:
            with self.lock:
                if self.enabled and generation == self.generation:
                    self.previous = self.confirmed_visual = self.pending_key = None
                    self.pending_snapshot = None
                    self.retry(str(error), 'waiting')

    def run(self):
        while True:
            self.tick()
            time.sleep(.35)

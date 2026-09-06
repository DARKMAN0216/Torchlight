"""Phase evidence is independent of effect evaluation. No round-number guessing."""
import re
import unicodedata
from functools import lru_cache
from pathlib import Path


def normalize(text):
    return re.sub(r'[\s·•・—–_-]', '', unicodedata.normalize('NFKC', text))


@lru_cache(maxsize=1)
def card_categories():
    path = Path(__file__).resolve().parent.parent / 'data' / '火炬之光无限_渴瘾症_全部卡牌统计.md'
    categories = {}
    phase = None
    try:
        content = path.read_text(encoding='utf-8')
    except OSError:
        return categories
    for line in content.splitlines():
        if line.startswith('## '):
            phase = 'surgeryRewardSelection' if line.startswith('## 三、') else (
                'potionSelection' if re.match(r'## [四五六七八九]、', line) else None)
        match = re.match(r'\|\s*\d+\s*\|\s*\*\*(.+?)\*\*', line)
        if phase and match:
            categories[normalize(match[1])] = phase
    return categories


def detect_phase(lines, candidates, width, height, categories=None):
    categories = card_categories() if categories is None else categories
    labels = []
    for line in lines:
        if line.confidence < .85:
            continue
        x, y = line.center_x/width, line.center_y/height
        text = normalize(line.text)
        heading = .44 <= x <= .67 and .62 <= y <= .70
        footer = .30 <= x <= .75 and .87 <= y <= .925
        phase = None
        if heading:
            phase = {'选择一种手术用具':'surgeryRewardSelection', '选择一种药剂':'potionSelection',
                     '选择一种手术方案':'surgeryPlanSelection'}.get(text)
        if footer:
            phase = {'手术用具':'surgeryRewardSelection', '普通药剂':'potionSelection',
                     '魔法药剂':'potionSelection', '稀有药剂':'potionSelection'}.get(text)
        if phase:
            labels.append((phase, line.confidence))
    label_phases = {phase for phase, _ in labels}
    names = [categories.get(normalize(c.text)) for c in candidates if c.confidence >= .85]
    known = {name for name in names if name}
    if len(label_phases) > 1 or (label_phases and known and not known.issubset(label_phases)):
        return 'unknown', .2, '阶段标签与卡名类别冲突，未自动判断'
    if label_phases:
        phase = next(iter(label_phases))
        confidence = min(score for _,score in labels)
    elif len(candidates) in (3,5) and len(names) == len(candidates) and all(names) and len(known) == 1:
        phase = next(iter(known))
        confidence = min(c.confidence for c in candidates) * .98
    else:
        return 'unknown', .2, '未可靠识别阶段标题/卡底类别，完整卡名类别证据不足'
    if phase == 'potionSelection' and len(candidates) == 5:
        phase = 'expandedPotionSelection'
    return phase, confidence, None

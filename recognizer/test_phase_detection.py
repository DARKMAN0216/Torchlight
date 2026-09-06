import unittest
from types import SimpleNamespace
from phase_detection import detect_phase, card_categories

def line(text, x=.55, y=.8, confidence=.99):
    return SimpleNamespace(text=text, center_x=x*2560, center_y=y*1440, confidence=confidence)

class PhaseDetectionTests(unittest.TestCase):
    def test_raised_permanent_names(self):
        names = [line(name) for name in ['斑斓肝脏', '肿大脑垂体', '人蛹标本']]
        phase, confidence, issue = detect_phase([], names, 2560, 1440)
        self.assertEqual(phase, 'surgeryRewardSelection')
        self.assertGreaterEqual(confidence, .85)
        self.assertIsNone(issue)

    def test_footer_can_identify_unknown_cards(self):
        self.assertEqual(detect_phase([line('手术用具', y=.90)], [line('未知')],2560,1440)[0], 'surgeryRewardSelection')

    def test_conflict_is_unknown(self):
        names = [line(name) for name in ['斑斓肝脏', '肿大脑垂体', '人蛹标本']]
        self.assertEqual(detect_phase([line('普通药剂', y=.90)], names,2560,1440)[0], 'unknown')

    def test_partial_low_confidence_and_body_are_not_phase(self):
        for names in [[line('斑斓肝脏')], [line('斑斓肝脏'),line('肿大脑垂体'),line('未知')],
                      [line('斑斓肝脏'),line('肿大脑垂体'),line('人蛹标本', confidence=.5)]]:
            self.assertEqual(detect_phase([line('手术用具', y=.78)], names,2560,1440)[0], 'unknown')

    def test_plan_header_and_expanded_potions(self):
        self.assertEqual(detect_phase([line('选择一种手术方案', y=.65)], [],2560,1440)[0], 'surgeryPlanSelection')
        self.assertEqual(detect_phase([line('魔法药剂', y=.90)], [line('未知')]*5,2560,1440)[0], 'expandedPotionSelection')
        self.assertEqual(card_categories()['人蛹标本'], 'surgeryRewardSelection')

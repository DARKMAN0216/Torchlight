import unittest
from choice_tracking import ChoiceTracker

BINDING = (123, 0, 0, 2560, 1440)
def snapshot(round_number=1, phase='surgeryRewardSelection', count=3):
    v = lambda value: dict(value=value, confidence=.99)
    return dict(round=v(round_number), phase=v(phase), sourceImage=dict(width=2560,height=1440),
                candidateCardNames=[dict(**v(f'牌{i}'), sourceRegion=dict(x=(.36+i*.075)*2560,y=1100,width=100,height=30)) for i in range(count)])

class ChoiceTrackingTests(unittest.TestCase):
    def setUp(self):
        self.now = 100
        self.t = ChoiceTracker(lambda:self.now)
        self.t.payload()
        self.t.observe(snapshot(), BINDING)

    def select(self, index=0):
        box = self.t.context['boxes'][index]
        self.t.click(box[0]+box[2]/2,.8,BINDING)

    def confirm(self):
        self.t.click(.55,.95,BINDING)

    def test_confirm_alone_not_a_selection(self):
        self.confirm()
        self.assertIsNone(self.t.pending)

    def test_reselection_and_target_toggle(self):
        self.select(); self.t.click(.221,.3,BINDING); self.t.click(.494,.3,BINDING)
        self.t.click(.221,.3,BINDING)
        self.assertEqual(self.t.pending['targetSlots'],[3])
        self.select(2)
        self.assertEqual(self.t.pending['cardIndex'],2)
        self.assertEqual(self.t.pending['targetSlots'],[])

    def test_confirm_and_next_f8_permanent_record_once(self):
        self.select(); self.confirm()
        self.select(1)  # after confirming, ignore subsequent game clicks
        self.t.observe(snapshot(2,'potionSelection'),BINDING)
        self.assertEqual(self.t.records[0]['status'],'transition-observed')
        self.assertEqual(self.t.records[0]['cardIndex'],0)
        self.t.observe(snapshot(2,'potionSelection'),BINDING)
        self.assertEqual(len(self.t.records),1)

    def test_missing_confirm_or_unchanged_remains_uncertain(self):
        self.select(); self.t.observe(snapshot(2,'potionSelection'),BINDING)
        self.assertEqual(self.t.records[-1]['status'],'uncertain')
        self.select(); self.confirm(); self.t.observe(snapshot(2,'potionSelection'),BINDING)
        self.assertEqual(self.t.records[-1]['status'],'uncertain')

    def test_refresh_invalidates_even_if_offers_change(self):
        self.select(); self.t.click(.63,.95,BINDING)
        self.assertIsNone(self.t.context)
        self.assertEqual(self.t.records[-1]['status'],'uncertain')
        self.assertIsNone(self.t.pending)

    def test_other_window_moved_geometry_and_expiry(self):
        self.t.click(.38,.8,(456,0,0,2560,1440))
        self.assertIsNone(self.t.pending)
        self.select(); self.t.click(.38,.8,(123,10,0,2560,1440))
        self.assertIsNone(self.t.context)
        self.t.observe(snapshot(),BINDING)
        self.now += 16
        self.select()
        self.assertIsNone(self.t.pending)
        self.t.payload()
        self.assertIsNone(self.t.context)

    def test_busy_reset_and_disable_discard_late_arm(self):
        generation = self.t.begin_capture()
        self.select(); self.assertIsNone(self.t.pending)
        self.t.reset(False)
        self.t.observe(snapshot(),BINDING,generation)
        self.assertIsNone(self.t.context)

    def test_five_cards_and_box_same_round_transition(self):
        self.t.observe(snapshot(3,'potionSelection'),BINDING)
        self.select(); self.confirm()
        self.t.observe(snapshot(3,'expandedPotionSelection',5),BINDING)
        self.assertEqual(self.t.records[-1]['status'],'transition-observed')
        self.select(4)
        self.assertEqual(self.t.pending['cardIndex'],4)

    def test_low_confidence_or_shared_region_does_not_arm(self):
        s = snapshot(); s['candidateCardNames'][1]['confidence'] = .6
        self.t.observe(s,BINDING); self.assertIsNone(self.t.context)
        s = snapshot()
        for n in s['candidateCardNames']: n['sourceRegion']['x']=1000
        self.t.observe(s,BINDING); self.assertIsNone(self.t.context)

    def test_no_auto_permanent_on_same_stage_reroll_or_round_jump(self):
        self.select(); self.confirm()
        s=snapshot(); s['candidateCardNames'][0]['value']='换牌'
        self.t.observe(s,BINDING)
        self.assertEqual(self.t.records[-1]['status'],'uncertain')
        self.select(); self.confirm(); self.t.observe(snapshot(7,'potionSelection'),BINDING)
        self.assertEqual(self.t.records[-1]['status'],'uncertain')

    def test_upload_or_different_geometry_not_confirmation(self):
        self.select(); self.confirm(); self.t.observe(snapshot(2,'potionSelection'))
        self.assertEqual(self.t.records[-1]['status'],'uncertain')
        self.assertIsNone(self.t.context)

    def test_native_hook_scopes_physical_clicks_and_always_passes_input(self):
        import ctypes
        from ctypes import wintypes
        from unittest.mock import MagicMock, patch
        from types import SimpleNamespace
        from choice_tracking import run_mouse_listener
        api = MagicMock()
        api.GetForegroundWindow.return_value = 123
        api.GetAncestor.return_value = 123
        api.SetWindowsHookExW.return_value = 444
        api.CallNextHookEx.return_value = 99
        class Input(ctypes.Structure):
            _fields_ = [('pt',wintypes.POINT),('mouseData',wintypes.DWORD),('flags',wintypes.DWORD),
                        ('time',wintypes.DWORD),('dwExtraInfo',ctypes.c_size_t)]
        click=Input(wintypes.POINT(970,1152),0,0,0,0)
        cycle=[0]
        def pump(ptr, *_):
            cycle[0]+=1
            callback=api.SetWindowsHookExW.call_args.args[1]
            if cycle[0]==1:
                click.flags=1
                self.assertEqual(callback(0,0x202,ctypes.addressof(click)),99)
                click.flags=0
                api.GetForegroundWindow.return_value=999
                callback(0,0x202,ctypes.addressof(click))
                api.GetForegroundWindow.return_value=123
                api.GetAncestor.return_value=999
                callback(0,0x202,ctypes.addressof(click))
                api.GetAncestor.return_value=123
                callback(0,0x200,ctypes.addressof(click))  # motion ignored
                return False
            if cycle[0]==2:
                self.assertIsNone(self.t.pending)
                callback(0,0x202,ctypes.addressof(click))
                return False
            ptr._obj.message=0x12
            return True
        api.PeekMessageW.side_effect=pump
        region=SimpleNamespace(left=0,top=0,width=2560,height=1440)
        with patch.object(ctypes,'WinDLL',return_value=api), patch('time.sleep'):
            run_mouse_listener(self.t,lambda:(123,region))
        self.assertEqual(self.t.pending['cardIndex'],0)
        self.assertEqual(api.CallNextHookEx.call_count,5)
        api.UnhookWindowsHookEx.assert_called_once_with(444)

if __name__ == '__main__': unittest.main()

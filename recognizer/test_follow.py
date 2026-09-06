import copy
import unittest
from unittest.mock import MagicMock, patch
import numpy as np
from follow import FollowController, complete_snapshot, stable_snapshot_key, snapshot_issue
import server

def v(value): return {'value':value,'confidence':.99}
def snapshot():
    return {'round':v(7),'phase':v('potionSelection'),'candidateCardNames':[v(n) for n in ['清疽油膏','纯粹活蛭溶液','鲜脊髓药粉']],
            'candidateCardIds':[], 'displayedFinalActivity':v(100),
            'monsterSlots':[{'slotId':f'slot-{i+1}','occupied':v(i==0),
                             **({'name':v('蝎兽'),'quantity':v(10),'unitActivity':v(10)} if i==0 else {})} for i in range(6)]}

class FollowTests(unittest.TestCase):
    def setUp(self):
        self.now = 100
        self.frame = np.zeros((11,48,192), dtype=bool)
        self.capture = MagicMock(side_effect=lambda:self.frame)
        self.result = {'snapshot':snapshot()}
        self.recognize = MagicMock(side_effect=lambda *args:copy.deepcopy(self.result))
        self.publish = MagicMock()
        self.follow = FollowController(self.capture,self.recognize,self.publish,lambda:self.now)
        self.key_patch = patch('follow.visual_key',side_effect=lambda image:image)
        self.key_patch.start()
        self.addCleanup(self.key_patch.stop)

    def tick(self, advance=1):
        self.now += advance
        self.follow.touch()
        self.follow.tick()

    def confirm(self):
        self.tick(); self.tick(); self.tick()

    def test_default_off_and_two_consistent_ocr_then_dedup(self):
        self.tick(); self.capture.assert_not_called()
        self.follow.toggle(); self.tick(); self.publish.assert_not_called()
        self.tick(); self.publish.assert_not_called()
        self.tick(); self.publish.assert_called_once()
        self.assertEqual(self.follow.status,'following')
        self.tick(); self.tick(); self.assertEqual(self.recognize.call_count,2)
        self.tick(8); self.publish.assert_called_once()

    def test_name_stable_visual_jitter_no_longer_blocks_confirmation(self):
        self.follow.toggle(); self.tick()
        self.result['snapshot']['monsterSlots'][0]['raceId']=v('aberrant')
        self.tick()
        self.result['snapshot']['monsterSlots'][0].pop('raceId')
        self.result['snapshot']['monsterSlots'][0]['rarity']=v('boss')
        self.tick(); self.publish.assert_called_once()
        # Unknown-name fallback must not inherit one uncorroborated visual observation.
        published = self.publish.call_args.args[0]['snapshot']['monsterSlots'][0]
        self.assertEqual(published['name']['value'],'蝎兽')
        self.assertNotIn('raceId',published); self.assertNotIn('rarity',published)
        self.assertEqual(self.follow.status,'following')

    def test_low_confidence_name_still_requires_visual_consistency(self):
        before=snapshot(); before['monsterSlots'][0]['name']['confidence']=.84
        after=copy.deepcopy(before); after['monsterSlots'][0]['raceId']=v('swarm')
        self.assertNotEqual(stable_snapshot_key(before),stable_snapshot_key(after))

    def test_semantics_keep_name_numbers_cards_rerolls_and_slot_identity(self):
        base=snapshot()
        for field, new in [('name','其他怪物'),('quantity',11),('unitActivity',11)]:
            changed=copy.deepcopy(base); changed['monsterSlots'][0][field]=v(new)
            self.assertNotEqual(stable_snapshot_key(base),stable_snapshot_key(changed))
        changed=copy.deepcopy(base); changed['rerollsRemaining']=v(2)
        self.assertNotEqual(stable_snapshot_key(base),stable_snapshot_key(changed))
        changed=copy.deepcopy(base); changed['candidateCardNames'][0]=v('其他药剂')
        self.assertNotEqual(stable_snapshot_key(base),stable_snapshot_key(changed))
        changed=copy.deepcopy(base); changed['monsterSlots'].reverse()
        self.assertEqual(stable_snapshot_key(base),stable_snapshot_key(changed))

    def test_periodic_recheck_keeps_confirmed_status_and_does_not_republish(self):
        self.follow.toggle(); self.confirm()
        statuses=[]
        def check(*args):
            statuses.append(self.follow.payload()['status']); return copy.deepcopy(self.result)
        self.recognize.side_effect=check
        self.tick(8)
        self.assertEqual(statuses,['checking']); self.publish.assert_called_once()
        self.assertEqual(self.follow.status,'following')

    def test_recheck_detects_semantic_change_even_if_visual_detector_missed_it(self):
        self.follow.toggle(); self.confirm()
        self.result['snapshot']['candidateCardNames'][0]=v('生骨药粉')
        self.tick(8); self.publish.assert_called_once()
        self.assertEqual(self.follow.status,'settling')
        self.assertIn('候选牌',self.follow.message)
        self.tick(); self.assertEqual(self.publish.call_count,2)

    def test_recheck_foreground_loss_hides_recommendation_without_publish(self):
        self.follow.toggle(); self.confirm()
        self.capture.side_effect=[self.frame,RuntimeError('等待游戏前台')]
        self.tick(8); self.publish.assert_called_once()
        self.assertEqual(self.follow.status,'waiting')

    def test_actual_visual_change_during_recheck_invalidates_confirmed_state(self):
        self.follow.toggle(); self.confirm()
        def change(*args):
            self.assertEqual(self.follow.status,'checking')
            self.frame=~self.frame; return self.result
        self.recognize.side_effect=change
        self.tick(8); self.publish.assert_called_once()
        self.assertEqual(self.follow.status,'settling')
        self.assertIsNone(self.follow.confirmed_visual)

    def test_failures_back_off_to_eight_seconds_and_report_specific_reason(self):
        self.follow.toggle(); self.result['snapshot']['monsterSlots'][0]['quantity']['confidence']=.1
        self.tick()
        for delay in [1,2,4,8,8]:
            self.tick(8)
            self.assertEqual(self.follow.payload()['retryAfterMs'],delay*1000)
            self.assertIn('slot-1 数量',self.follow.message)
            count=self.recognize.call_count
            self.tick(.1); self.assertEqual(self.recognize.call_count,count)
        self.result['snapshot']['monsterSlots'][0]['quantity']['confidence']=.99
        self.tick(8); self.tick()
        self.publish.assert_called_once(); self.assertEqual(self.follow.payload()['retryCount'],0)

    def test_pause_cancels_backoff_and_new_run_resets_diagnostics(self):
        self.follow.toggle(); self.capture.side_effect=RuntimeError('截图失败')
        self.tick(); self.assertEqual(self.follow.payload()['retryCount'],1)
        self.follow.set_enabled(False); count=self.capture.call_count
        self.tick(10); self.assertEqual(self.capture.call_count,count)
        self.follow.set_enabled(True); self.capture.side_effect=lambda:self.frame
        self.assertEqual(self.follow.payload()['retryAfterMs'],0)
        self.confirm(); self.publish.assert_called_once()

    def test_quality_failure_reports_hud_and_card_problems(self):
        s=snapshot(); s['displayedFinalActivity']=v(99)
        self.assertIn('合计 100',snapshot_issue(s))
        s['candidateCardNames']=[]; self.assertIn('候选牌',snapshot_issue(s))

    def test_visual_key_ignores_pixels_in_race_icon_band(self):
        self.key_patch.stop()
        from follow import visual_key, same_visual
        base=np.zeros((1440,2560,3),dtype=np.uint8); changed=base.copy()
        changed[492:505,1210:1240]=255
        self.assertTrue(same_visual(visual_key(base),visual_key(changed)))

    def test_short_animation_never_reaches_ocr(self):
        self.follow.toggle(); self.tick()
        self.frame=~self.frame; self.tick(.2)
        self.frame=~self.frame; self.tick(.2)
        self.recognize.assert_not_called()

    def test_pause_during_ocr_discards_late_result(self):
        self.follow.toggle(); self.tick()
        self.recognize.side_effect=lambda *a: (self.follow.set_enabled(False) or self.result)
        self.tick(); self.publish.assert_not_called(); self.assertEqual(self.follow.status,'paused')

    def test_restart_during_ocr_rejects_old_generation(self):
        self.follow.toggle(); self.tick()
        def restart(*args):
            self.follow.set_enabled(False); self.follow.set_enabled(True); return self.result
        self.recognize.side_effect=restart
        self.tick(); self.publish.assert_not_called()

    def test_foreground_loss_waits_without_inference_and_resumes(self):
        self.follow.toggle()
        self.capture.side_effect=RuntimeError('等待游戏前台')
        self.tick(); self.recognize.assert_not_called(); self.assertEqual(self.follow.status,'waiting')
        self.capture.side_effect=lambda:self.frame
        self.confirm(); self.publish.assert_called_once()

    def test_game_changes_while_ocr_runs_do_not_publish_old_frame(self):
        self.follow.toggle(); self.tick()
        def animate(*args):
            self.frame=~self.frame; return self.result
        self.recognize.side_effect=animate
        self.tick(); self.publish.assert_not_called(); self.assertEqual(self.follow.status,'settling')

    def test_different_semantic_results_need_another_confirmation(self):
        self.follow.toggle(); self.tick(); self.tick()
        self.result['snapshot']['round']=v(8)
        self.tick(); self.publish.assert_not_called()
        self.tick(); self.publish.assert_called_once()

    def test_deletion_and_five_card_box_publish_only_stable_new_state(self):
        self.follow.toggle(); self.confirm()
        self.frame=~self.frame
        self.result['snapshot']['monsterSlots'][0]={'slotId':'slot-1','occupied':v(False)}
        self.result['snapshot']['displayedFinalActivity']=v(0)
        self.result['snapshot']['candidateCardNames'] += [v('生骨药粉'),v('石化脊髓溶液')]
        self.result['snapshot']['phase']=v('expandedPotionSelection')
        self.confirm(); self.assertEqual(self.publish.call_count,2)
        self.assertEqual(len(self.publish.call_args.args[0]['snapshot']['candidateCardNames']),5)

    def test_incomplete_or_inconsistent_frame_never_clears_saved_board(self):
        self.follow.toggle()
        self.result['snapshot']['displayedFinalActivity']=v(0)
        self.confirm(); self.publish.assert_not_called()
        self.result['snapshot']['candidateCardNames']=[]
        self.confirm(); self.publish.assert_not_called()

    def test_close_client_expires_lease_and_stops_capture(self):
        self.follow.toggle(); self.now+=16; self.follow.tick()
        self.assertFalse(self.follow.enabled); self.capture.assert_not_called()

    def test_quality_gate_and_semantic_key_ignore_confidence_jitter(self):
        s=snapshot(); self.assertTrue(complete_snapshot(s))
        other=copy.deepcopy(s); other['round']['confidence']=.9; other['capturedAt']='later'
        self.assertEqual(stable_snapshot_key(s),stable_snapshot_key(other))
        other['monsterSlots'][0]['quantity']['confidence']=.2
        self.assertFalse(complete_snapshot(other))
        other=copy.deepcopy(s); other['monsterSlots'][5]['slotId']='slot-1'
        self.assertFalse(complete_snapshot(other))

    def test_foreign_foreground_cannot_enter_native_capture(self):
        user32=MagicMock(); user32.GetForegroundWindow.return_value=999
        with patch.object(server,'find_torchlight_window',return_value=(123,server.ClientRegion(0,0,2560,1440))), \
             patch.object(server.ctypes,'WinDLL',return_value=user32):
            with self.assertRaisesRegex(RuntimeError,'等待游戏前台'): server.capture_follow_window()
        user32.EnumWindows.assert_not_called()
        user32.SetForegroundWindow.assert_not_called()

    def test_unprotected_overlay_waits_without_hiding_or_grabbing(self):
        user32=MagicMock(); user32.GetForegroundWindow.return_value=123
        user32.IsIconic.return_value=False
        user32.EnumWindows.side_effect=lambda callback,_:callback(456,0)
        with patch.object(server,'find_torchlight_window',return_value=(123,server.ClientRegion(0,0,2560,1440))), \
             patch.object(server.ctypes,'WinDLL',return_value=user32), \
             patch.object(server,'process_image_name',return_value=server.ASSISTANT_PROCESS_NAME), \
             patch('mss.mss') as grab:
            with self.assertRaisesRegex(RuntimeError,'截图排除'): server.capture_follow_window()
            grab.assert_not_called()
        user32.SetWindowPos.assert_not_called(); user32.ShowWindow.assert_not_called()

    def test_manual_ocr_result_is_discarded_after_starting_follow(self):
        store=server.HotkeyRecognitionStore(MagicMock())
        epoch=store.follow.generation
        store.follow.set_enabled(True)
        with patch.object(server,'capture_torchlight_window',return_value='image'):
            store._recognize(epoch)
        self.assertIsNone(store.payload()['result'])

    def capture_with_event_target(self, protected):
        user32=MagicMock(); user32.GetForegroundWindow.return_value=123
        user32.IsIconic.return_value=False
        def enumerate_windows(callback, _):
            callback(456, 0); callback(789, 0); return 1
        def window_class(hwnd, buffer, size):
            buffer.value='Tao Thread Event Target' if hwnd == 456 else 'Real Overlay'
            return len(buffer.value)
        def affinity(hwnd, value):
            value._obj.value=17 if protected and hwnd == 789 else 0
            return 1
        user32.EnumWindows.side_effect=enumerate_windows
        user32.GetClassNameW.side_effect=window_class
        user32.GetWindowDisplayAffinity.side_effect=affinity
        with patch.object(server,'find_torchlight_window',return_value=(123,server.ClientRegion(0,0,100,100))), \
             patch.object(server.ctypes,'WinDLL',return_value=user32), \
             patch.object(server,'process_image_name',return_value=server.ASSISTANT_PROCESS_NAME), \
             patch.object(server,'require_torchlight_window_foreground'), \
             patch('mss.mss') as capture:
            capture.return_value.__enter__.return_value.grab.return_value=np.zeros((100,100,4),dtype=np.uint8)
            if protected:
                self.assertEqual(server.capture_follow_window().shape,(100,100,3))
                capture.assert_called_once()
            else:
                with self.assertRaisesRegex(RuntimeError,'截图排除'): server.capture_follow_window()
                capture.assert_not_called()
        self.assertEqual([call.args[0] for call in user32.GetWindowDisplayAffinity.call_args_list],[789])
        user32.SetWindowPos.assert_not_called(); user32.ShowWindow.assert_not_called()
        user32.SetForegroundWindow.assert_not_called()

    def test_event_target_does_not_block_protected_real_overlay(self):
        self.capture_with_event_target(True)

    def test_event_target_exception_does_not_bypass_real_overlay_protection(self):
        self.capture_with_event_target(False)

    def test_unknown_window_class_is_not_exempt(self):
        user32=MagicMock(); user32.GetClassNameW.return_value=0
        self.assertFalse(server.is_assistant_event_target(user32,456))
        def near_match(hwnd, buffer, size):
            buffer.value='Tao Thread Event Target extra'; return len(buffer.value)
        user32.GetClassNameW.side_effect=near_match
        self.assertFalse(server.is_assistant_event_target(user32,456))

if __name__=='__main__': unittest.main()

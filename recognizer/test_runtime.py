import threading
import json
import http.client
import time
import numpy as np
from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch

import server


class RuntimeTests(unittest.TestCase):
    def test_icon_ocr_noise_does_not_ambiguate_name_rarity(self):
        recognizer = server.GameRecognizer.__new__(server.GameRecognizer)
        image = np.zeros((1440, 2560, 3), dtype=np.uint8)
        image[510:533, 480:565] = (20, 180, 220)
        lines = [server.OcrLine('乐', .55, [[510,490],[530,490],[530,510],[510,510]]),
                 server.OcrLine('邪眼翼兽', .99, [[480,510],[565,510],[565,533],[480,533]])]
        self.assertEqual(recognizer.recognize_name_rarity(image, lines)['value'], 'rare')

    def test_new_icon_variants_keep_old_sample_and_empty_slots_correct(self):
        references = Path(__file__).resolve().parent.parent / 'design' / 'references'
        with patch.object(server, 'RapidOCR'):
            recognizer = server.GameRecognizer()
        for file, expected in [
            ('round-7-rarity-icon-regression-2560x1440.png', ['aberrant','awakened','awakened','construct',None,None]),
            ('round-1-rarity-sync-2560x1440.png', ['construct','construct','awakened','awakened',None,None]),
        ]:
            image = server.cv2.imread(str(references / file))
            for slot, race in enumerate(expected):
                result = recognizer.recognize_race_icon(image, slot)
                self.assertEqual(result[0] if result else None, race, (file, slot))

    def test_card_title_can_contain_activity_and_body_is_not_a_title(self):
        lines = [server.OcrLine(text, .99, [[x-30,y-10],[x+30,y-10],[x+30,y+10],[x-30,y+10]])
                 for text,x,y in [('鲜脊髓药粉',1197,1123), ('清疽油膏',1411,1117),
                                  ('活性育卵激素',1623,1123), ('添加1组蛊虫，50%',1621,1159)]]
        titles = server.GameRecognizer._candidate_title_lines(lines,2560,1440)
        self.assertEqual([line.text for line in titles], ['鲜脊髓药粉','清疽油膏','活性育卵激素'])

    def test_rarity_color_votes_and_ambiguous_rejection(self):
        # Synthetic colors validate classification only, not unseen live red/yellow names.
        colors = {'common': (180, 180, 180), 'magic': (210, 170, 110),
                  'rare': (20, 180, 220), 'boss': (30, 30, 220)}
        for rarity, bgr in colors.items():
            patch_image = np.full((20, 40, 3), bgr, dtype=np.uint8)
            self.assertEqual(server.GameRecognizer.classify_name_color(patch_image)[0], rarity)
        patch_image[:10] = colors['common']
        self.assertIsNone(server.GameRecognizer.classify_name_color(patch_image))
        self.assertIsNone(server.GameRecognizer.classify_name_color(np.zeros((20, 40, 3), dtype=np.uint8)))

    def test_rarity_uses_name_box_not_nearby_red_icon_or_numbers(self):
        recognizer = server.GameRecognizer.__new__(server.GameRecognizer)
        image = np.zeros((1000, 1000, 3), dtype=np.uint8)
        image[340:350, 200:250] = (0, 0, 255)
        image[355:370, 200:250] = (180, 180, 180)
        image[375:390, 200:250] = (0, 0, 255)
        lines = [server.OcrLine('未收录名字', 0.99, [[200,355],[250,355],[250,370],[200,370]]),
                 server.OcrLine('120', 0.99, [[200,375],[250,375],[250,390],[200,390]])]
        self.assertEqual(recognizer.recognize_name_rarity(image, lines)['value'], 'common')
        self.assertIsNone(recognizer.recognize_name_rarity(image, lines[1:]))

    def test_hotkey_reports_progress_and_drops_duplicate_trigger(self):
        store = server.HotkeyRecognitionStore(MagicMock())
        with patch.object(server.threading, 'Thread') as thread:
            self.assertTrue(store.trigger())
            self.assertFalse(store.trigger())
            self.assertEqual(store.payload()['status'], 'recognizing')
            self.assertEqual(store.payload()['sequence'], 1)
            thread.return_value.start.assert_called_once()
        with patch.object(server, 'capture_torchlight_window', return_value='image'):
            store._recognize()
        self.assertEqual(store.payload()['status'], 'completed')
        self.assertEqual(store.payload()['sequence'], 1)
        self.assertNotEqual(store.session_id, server.HotkeyRecognitionStore(MagicMock()).session_id)

    def test_capture_failure_is_reported(self):
        store = server.HotkeyRecognitionStore(MagicMock())
        with patch.object(server, 'capture_torchlight_window', side_effect=RuntimeError('game unavailable')):
            store._recognize()
        self.assertEqual(store.payload()['status'], 'failed')
        self.assertEqual(store.payload()['error'], 'game unavailable')

    def test_shared_engine_rejects_concurrent_requests_and_releases_on_error(self):
        recognizer = server.GameRecognizer.__new__(server.GameRecognizer)
        recognizer._inference_lock = threading.Lock()
        recognizer._inference_lock.acquire()
        with self.assertRaisesRegex(RuntimeError, '上一张'):
            recognizer.recognize(None, 'test')
        recognizer._inference_lock.release()
        with patch.object(recognizer, '_recognize', side_effect=ValueError('bad image')):
            with self.assertRaises(ValueError):
                recognizer.recognize(None, 'test')
        self.assertFalse(recognizer._inference_lock.locked())

    def fake_windows(self, foreground):
        user32 = MagicMock()
        user32.GetForegroundWindow.return_value = foreground
        user32.IsWindowVisible.return_value = True
        user32.IsIconic.return_value = False
        user32.EnumWindows.side_effect = lambda callback, _: callback(123, 0)
        user32.SetForegroundWindow.side_effect = lambda hwnd: setattr(user32.GetForegroundWindow, 'return_value', hwnd) or 1
        return user32

    def test_overlay_is_restored_without_activation_even_when_capture_fails(self):
        user32 = self.fake_windows(123)
        with patch.object(server.ctypes, 'WinDLL', return_value=user32), \
             patch.object(server, 'process_image_name', return_value=server.ASSISTANT_PROCESS_NAME), \
             patch.object(server.time, 'sleep'):
            with self.assertRaisesRegex(ValueError, 'grab failed'):
                with server.assistant_hidden_for_capture(456):
                    raise ValueError('grab failed')
        user32.SetForegroundWindow.assert_called_once_with(456)
        self.assertEqual(user32.SetWindowPos.call_args.args, (123, None, 0, 0, 0, 0, 0x97))
        self.assertEqual(user32.ShowWindow.call_args_list[-1].args, (123, 8))

    def test_foreign_foreground_does_not_hide_or_capture_anything(self):
        user32 = self.fake_windows(999)
        with patch.object(server.ctypes, 'WinDLL', return_value=user32), \
             patch.object(server, 'process_image_name', return_value=server.ASSISTANT_PROCESS_NAME):
            with self.assertRaisesRegex(RuntimeError, '不会捕获其他应用'):
                with server.assistant_hidden_for_capture(456):
                    self.fail('must not capture')
        user32.ShowWindow.assert_not_called()
        user32.SetForegroundWindow.assert_not_called()

    def test_game_foreground_is_not_reactivated(self):
        user32 = self.fake_windows(456)
        with patch.object(server.ctypes, 'WinDLL', return_value=user32), \
             patch.object(server, 'process_image_name', return_value=server.ASSISTANT_PROCESS_NAME), \
             patch.object(server.time, 'sleep'):
            with server.assistant_hidden_for_capture(456):
                pass
        user32.SetForegroundWindow.assert_not_called()

    def test_focus_denied_does_not_hide_windows(self):
        user32 = self.fake_windows(123)
        user32.SetForegroundWindow.side_effect = None
        user32.SetForegroundWindow.return_value = 0
        with patch.object(server.ctypes, 'WinDLL', return_value=user32), \
             patch.object(server, 'process_image_name', return_value=server.ASSISTANT_PROCESS_NAME), \
             patch.object(server.time, 'sleep'):
            with self.assertRaisesRegex(RuntimeError, '游戏仍不在前台'):
                with server.assistant_hidden_for_capture(456):
                    self.fail('must not capture')
        user32.SetWindowPos.assert_not_called()

    def test_focus_changed_during_hiding_aborts_and_restores(self):
        user32 = self.fake_windows(456)
        user32.SetWindowPos.side_effect = lambda *args: setattr(user32.GetForegroundWindow, 'return_value', 999) or 1
        with patch.object(server.ctypes, 'WinDLL', return_value=user32), \
             patch.object(server, 'process_image_name', return_value=server.ASSISTANT_PROCESS_NAME), \
             patch.object(server.time, 'sleep'):
            with self.assertRaises(RuntimeError):
                with server.assistant_hidden_for_capture(456):
                    self.fail('must not capture')
        user32.ShowWindow.assert_called_once_with(123, 8)

    def test_f8_poll_and_message_deduplicate_in_both_orders(self):
        for poll_first in (True, False):
            store = MagicMock()
            dispatch = server.F8Dispatcher(store)
            if poll_first:
                dispatch.sample(True, True, 1)
                dispatch.dispatch('wm-hotkey', 1.01)
            else:
                dispatch.dispatch('wm-hotkey', 1)
                dispatch.sample(True, True, 1.01)
            dispatch.sample(True, True, 10)  # held key never repeats
            store.trigger.assert_called_once()
            dispatch.sample(False, True, 10.1)
            dispatch.sample(True, True, 11)
            self.assertEqual(store.trigger.call_count, 2)

    def test_f8_ignored_edge_does_not_trigger_on_focus_change_while_held(self):
        store = MagicMock()
        dispatch = server.F8Dispatcher(store)
        dispatch.sample(True, False, 1)
        dispatch.sample(True, True, 2)
        store.trigger.assert_not_called()

    def test_elapsed_time_stops_after_failure(self):
        store = server.HotkeyRecognitionStore(MagicMock())
        store._started_at = time.perf_counter() - 1
        with patch.object(server, 'capture_torchlight_window', side_effect=RuntimeError('test')):
            store._recognize()
        elapsed = store.payload()['elapsedMs']
        with patch.object(server.time, 'perf_counter', return_value=time.perf_counter() + 100):
            self.assertEqual(store.payload()['elapsedMs'], elapsed)


class HttpRoutingTests(unittest.TestCase):
    def setUp(self):
        self.store = MagicMock()
        self.store.trigger.return_value = True
        self.store.payload.return_value = {'sequence': 1, 'status': 'recognizing'}
        class Handler(server.RecognitionHandler):
            hotkey_store = self.store
        self.http = server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.worker = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.worker.start()

    def tearDown(self):
        self.http.shutdown()
        self.http.server_close()
        self.worker.join(2)

    def request(self, method, path, origin='http://tauri.localhost'):
        connection = http.client.HTTPConnection(*self.http.server_address, timeout=2)
        try:
            connection.request(method, path, headers={'Origin': origin})
            response = connection.getresponse()
            return response.status, json.loads(response.read())
        finally:
            connection.close()

    def test_real_post_route_triggers_exactly_once_without_logging_recursion(self):
        status, payload = self.request('POST', '/trigger-capture')
        self.assertEqual(status, 202)
        self.assertTrue(payload['accepted'])
        self.store.trigger.assert_called_once_with('capture-button')

    def test_get_and_options_do_not_trigger_capture(self):
        self.assertEqual(self.request('GET', '/trigger-capture')[0], 404)
        self.store.trigger.assert_not_called()

    def test_untrusted_origin_cannot_trigger_capture(self):
        self.assertEqual(self.request('POST', '/trigger-capture', 'https://example.com')[0], 403)
        self.store.trigger.assert_not_called()

    def test_busy_response_does_not_retry(self):
        self.store.trigger.return_value = False
        status, payload = self.request('POST', '/trigger-capture')
        self.assertEqual(status, 202)
        self.assertFalse(payload['accepted'])
        self.store.trigger.assert_called_once()


if __name__ == '__main__':
    unittest.main()

"""Exercise exceptional cleanup without starting a renderer or touching a device."""
import os
import signal
import tempfile
import unittest
from unittest.mock import patch

import opentui_review_confirmation_pty as helper


class CleanupTest(unittest.TestCase):
    def test_startup_failure_reaps_only_owned_child_and_removes_resources(self):
        for run in (
            lambda: helper.run_scenario('.', '.', 'device-to-plan', 'device_confirm'),
            lambda: helper.run_chat_input_scenario('.', '.'),
        ):
            master = os.open(os.devnull, os.O_RDONLY)
            fd, event_path = tempfile.mkstemp(prefix='itestagent-pty-cleanup-test-')
            failure = RuntimeError('synthetic frame read failure')
            try:
                with patch.object(helper.tempfile, 'mkstemp', return_value=(fd, event_path)), \
                     patch.object(helper.pty, 'fork', return_value=(42, master)), \
                     patch.object(helper.fcntl, 'ioctl'), \
                     patch.object(helper, 'read_initial_frame', side_effect=failure), \
                     patch.object(helper.os, 'waitpid', side_effect=[(0, 0), (42, 9)]) as wait, \
                     patch.object(helper.os, 'kill') as kill:
                    with self.assertRaises(RuntimeError) as caught:
                        run()
                    self.assertIs(caught.exception, failure)
                    kill.assert_called_once_with(42, signal.SIGKILL)
                    self.assertEqual(wait.call_count, 2)
                self.assertFalse(os.path.exists(event_path))
                with self.assertRaises(OSError):
                    os.fstat(master)
            finally:
                for descriptor in (fd, master):
                    try:
                        os.close(descriptor)
                    except OSError:
                        pass
                if os.path.exists(event_path):
                    os.unlink(event_path)


if __name__ == '__main__':
    unittest.main()

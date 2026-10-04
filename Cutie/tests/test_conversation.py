import unittest
from unittest.mock import patch

import mira


class ConversationTests(unittest.TestCase):
    def test_chat_action_speaks_back(self):
        with patch.object(mira, "speak", return_value=None) as mocked_speak:
            self.assertTrue(mira.execute_ai_action({"action": "chat", "text": "Hello there"}))
            mocked_speak.assert_called_once_with("Hello there")

    def test_identity_reply_mentions_creator(self):
        reply = mira.get_local_chat_reply("who made you")
        self.assertIn("Rohit Mehra", reply)
        self.assertIn("B.Tech CSE", reply)

    def test_emotional_reply_is_caring(self):
        reply = mira.get_local_chat_reply("i am sad")
        self.assertIn("sad", reply.lower())
        self.assertIn("here", reply.lower())

    def test_javascript_hello_reply(self):
        reply = mira.get_local_chat_reply("how can i write the hello word in javascript")
        self.assertIn("console.log", reply.lower())

    def test_whatsapp_message_command_opens_whatsapp(self):
        with patch.object(mira, "speak", return_value=None) as mocked_speak, patch.object(mira.subprocess, "run") as mocked_run:
            self.assertTrue(mira.try_fixed_commands("send a message to unknown in whatsapp"))
            mocked_speak.assert_called_once()
            self.assertTrue(any("whatsapp" in str(call.args).lower() for call in mocked_run.call_args_list))


if __name__ == "__main__":
    unittest.main()

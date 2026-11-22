"""Per-conversation model history, kept on disk.

Each conversation the browser opens has an id. Its model-visible messages
(user, assistant, tool) are appended to sessions/<id>.jsonl, one JSON object
per line. The log is append-only: a turn adds lines, nothing is rewritten.
That makes it the source of truth for what the model saw (the same idea as the
DeepSeek harness's session log, see docs/Research/DeepSeek harness.md), and
it survives server restarts.

The system prompt is NOT logged: it is rebuilt every turn, so changes to it
(and to the long-term memory inside it) reach existing conversations too.
"""

import json
import re
from pathlib import Path

# Ids come from the browser, and become file names: allow only a safe alphabet.
_ID = re.compile(r"^[A-Za-z0-9_-]{1,100}$")


class SessionStore:
    def __init__(self, root: Path):
        self.root = root

    def valid(self, conversation_id: str) -> bool:
        return bool(_ID.match(conversation_id))

    def _path(self, conversation_id: str) -> Path:
        if not self.valid(conversation_id):
            raise ValueError(f"invalid conversation id {conversation_id!r}")
        return self.root / f"{conversation_id}.jsonl"

    def load(self, conversation_id: str) -> list[dict]:
        """The conversation's messages, oldest first. Unknown id → empty list."""
        path = self._path(conversation_id)
        if not path.exists():
            return []
        messages = []
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                messages.append(json.loads(line))
            except json.JSONDecodeError:
                continue  # a line cut off by a crash: skip it, keep the rest
        return messages

    def append(self, conversation_id: str, messages: list[dict]) -> None:
        if not messages:
            return
        path = self._path(conversation_id)
        self.root.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as f:
            for m in close_open_tool_calls(messages):
                f.write(json.dumps(m, ensure_ascii=False) + "\n")

    def delete(self, conversation_id: str) -> bool:
        path = self._path(conversation_id)
        if not path.exists():
            return False
        path.unlink()
        return True


def close_open_tool_calls(messages: list[dict]) -> list[dict]:
    """Add a result for any tool call that never got one.

    A turn cancelled while a tool runs leaves an assistant message whose
    tool_calls have no matching `tool` messages. OpenAI-compatible servers
    reject that history on the next turn, so close those calls here.
    """
    answered = {m.get("tool_call_id") for m in messages if m.get("role") == "tool"}
    out: list[dict] = []
    for m in messages:
        out.append(m)
        for call in m.get("tool_calls") or []:
            if call.get("id") not in answered:
                out.append({"role": "tool", "tool_call_id": call.get("id"), "content": "cancelled by the user"})
                answered.add(call.get("id"))
    return out

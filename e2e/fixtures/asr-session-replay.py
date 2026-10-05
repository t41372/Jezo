"""Replay protocol edge cases through the installed SDK and Jezo's adapter.

This is a session-contract probe, not an inference engine or plugin. Real model
inference is tested separately. No SDK methods or installed plugins are patched.
"""
import importlib.util
import io
import json
from pathlib import Path
from types import SimpleNamespace

from standard_asr import TranscriptionEvent, TranscriptionSession
from standard_asr.contract.capabilities import DeclaredCapabilities, StreamingCapabilities

spec = importlib.util.spec_from_file_location(
    "jezo_asr", Path(__file__).resolve().parents[2] / "resources/standard-asr.py")
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


class ReplaySession(TranscriptionSession):
    def __init__(self, events, strict=False):
        super().__init__(strict_lifecycle=strict)
        self.events = events

    async def _produce(self):
        for event in self.events:
            yield TranscriptionEvent.model_validate(event)


def run(name, events, capabilities, strict=False):
    # Structural engines need the adapter's binding; EngineBase already binds.
    engine = SimpleNamespace(
        declared_capabilities=DeclaredCapabilities(streaming=StreamingCapabilities(
            emits_partials={"supported": True}, partial_stability={"supported": True},
            re_segments={"supported": True})),
        effective_capabilities=DeclaredCapabilities(streaming=StreamingCapabilities(**capabilities)))
    adapter.OUTPUT = io.StringIO()
    adapter.stream_session(engine, ReplaySession(events, strict))
    return {"name": name, "messages": [json.loads(line) for line in adapter.OUTPUT.getvalue().splitlines()]}


def text(kind, segment, value, stable=None, **extra):
    return {"type": kind, "segment_id": segment, "text": value,
            **({"stable_text": stable} if stable is not None else {}), **extra}


allowed = {"emits_partials": {"supported": True}, "partial_stability": {"supported": True},
           "re_segments": {"supported": True}}
cases = [
    run("unicode-supersede-closed", [
        text("partial", "a", "👩‍💻𠮷野家 hello", "👩‍💻𠮷野家 "),
        text("final", "b", " tail"),
        {"type": "supersede", "old_ids": ["a"], "new_ids": ["c", "d"]},
        text("final", "d", "ใหม่"),
        text("final", "c", "新"),
        text("final", "c", "新！", finality="closed"),
    ], allowed),
    run("abandoned-stable-text", [text("partial", "a", "do not send", "do not ")], allowed),
    run("effective-capabilities", [
        text("partial", "a", "hello", "hell"),
        text("partial", "a", "hello!", "hell"),
        {"type": "supersede", "old_ids": ["a"], "new_ids": ["b"]},
        text("final", "b", "replacement"),
    ], {"finality_level": {"mode": "closed"}}),
    run("strict-failure", [text("partial", "a", "draft", "")], {}, strict=True),
]
print(json.dumps(cases, ensure_ascii=False))

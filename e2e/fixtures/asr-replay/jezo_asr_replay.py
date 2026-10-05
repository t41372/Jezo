"""Controlled protocol events through the real SDK, sidecar, IPC and windows.

This plugin does no inference. It supplies the lifecycle edge cases that a
neural model cannot reproduce on demand; asr.spec.ts tests real inference.
No application handlers or SDK methods are replaced.
"""
from typing import ClassVar, Literal

from standard_asr.engine import (
    BaseConfig, BaseProperties, DeclaredCapabilities, DeclaredEngineMetadata,
    EngineBase, NO_ARTIFACT_LIFECYCLE, StreamingCapabilities,
    TranscriptionEvent, TranscriptionSession,
)


class Config(BaseConfig[Literal["jezo-replay"]]):
    engine: Literal["jezo-replay"] = "jezo-replay"
    outcome: Literal["empty", "failure", "final"] = "empty"


class Session(TranscriptionSession):
    def __init__(self, outcome):
        super().__init__()
        self.outcome = outcome

    async def _produce(self):
        heard = False
        async for chunk in self.audio_chunks():
            if chunk and not heard:
                heard = True
                yield TranscriptionEvent(type="partial", segment_id="a", text="early draft")
        if self.outcome == "failure":
            # Arrives after the user's release, so a captured UI preview is stale.
            yield TranscriptionEvent(type="partial", segment_id="a", text="latest editable draft")
            yield TranscriptionEvent(type="error", code="engine_error", recoverable=False,
                                     extra={"detail": "Replay recognition failed"})
        elif self.outcome == "final":
            yield TranscriptionEvent(type="final", segment_id="a", text="completed dictation")
        # Empty: the SDK discards the abandoned partial and returns text="".


class Engine(EngineBase):
    config_type = Config
    properties: ClassVar[BaseProperties] = BaseProperties(
        engine_id="jezo-replay", model_name="session", protocol_version="0.2.0",
        accepted_input={"array"}, native_sample_rate=16000,
        accepted_sample_rates=[16000], wire_encodings=["pcm_s16le"],
    )
    declared_capabilities = DeclaredCapabilities(
        streaming_input={"supported": True},
        streaming=StreamingCapabilities(emits_partials={"supported": True}),
    )
    declared_metadata = DeclaredEngineMetadata(artifacts=NO_ARTIFACT_LIFECYCLE)

    def __init__(self, **kwargs):
        self.config = Config(**kwargs)

    def _transcribe(self, prepared, params):
        raise NotImplementedError("This fixture uses incremental streaming")

    def _start_transcription(self, **kwargs):
        return Session(self.config.outcome)


def create(**kwargs) -> Engine:
    return Engine(**kwargs)

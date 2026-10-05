"""Jezo's local adapter for Standard ASR main, including the PR 107 contract.

Each management call runs in a fresh interpreter so newly installed entry points
are immediately visible. Recognition uses the SDK directly, including typed engine parameters.
"""

import contextlib
import importlib.metadata as metadata
import json
import platform
import threading
import sys

OUTPUT = sys.stdout
OUTPUT_LOCK = threading.Lock()


def error_message(error):
    from standard_asr.runtime.redaction import safe_exception_summary
    return safe_exception_summary(error)


def emit(kind, value):
    with OUTPUT_LOCK:
        OUTPUT.write(json.dumps({"kind": kind, "value": value}, default=str) + "\n")
        OUTPUT.flush()


def package(dist):
    direct = json.loads(dist.read_text("direct_url.json") or "{}")
    vcs = direct.get("vcs_info", {})
    return {
        "name": dist.metadata["Name"],
        "version": dist.version,
        "source": direct.get("url"),
        "commit": vcs.get("commit_id"),
        "revision": vcs.get("requested_revision"),
        "vcs": vcs.get("vcs"),
        "subdirectory": direct.get("subdirectory"),
        "editable": direct.get("dir_info", {}).get("editable", False),
        "engines": sorted({ep.name.split("/")[0] for ep in dist.entry_points
                           if ep.group == "standard_asr.models"}),
    }


def declarations(registry, key):
    from standard_asr.runtime.interface import require_engine_protocol

    spec = registry.spec(key)
    result = {"id": key, "engine": spec.engine_id, "name": spec.model_name,
              "package": spec.entry_point.dist.metadata["Name"], "properties": {},
              "capabilities": {}, "metadata": {}, "dictation": None, "error": None}
    try:
        cls = registry.engine_class(key)
        props = require_engine_protocol(cls)
        result.update(properties=props.model_dump(mode="json"),
                      capabilities=cls.declared_capabilities.canonical_json(),
                      metadata=cls.declared_metadata.canonical_json(),
                      dictation=dictation(cls.declared_capabilities.supports, props))
    except Exception as error:
        result["error"] = error_message(error)
    return result


def dictation(supports, props):
    """How Jezo records for this model: the one rule, shared by listen and the window."""
    incremental = supports("streaming_input") and (
        props.wire_encodings is None or "pcm_s16le" in props.wire_encodings)
    return {"mode": "streaming" if incremental or not supports("batch") else "batch",
            "incremental": bool(incremental),
            "sampleRate": (props.required_input_sample_rate or props.native_sample_rate)
            if incremental else 16000}


def config_for(registry, key, request):
    values = dict(request.get("models", {}).get(key, {}).get("config", {}))
    return values


def runtime_features():
    import standard_asr
    from standard_asr import TranscriptionEvent

    # PR 107 changed the pre-release contract without changing protocol 0.2.
    # Report features rather than guessing from the unchanged package version.
    return {"stableText": "stable_text" in TranscriptionEvent.model_fields,
            "sessionCapabilityChecks": callable(getattr(standard_asr, "bind_session_capabilities", None))}


def params_for(registry, key, settings):
    from standard_asr import RuntimeParams

    values = dict(settings.get("options", {}))
    native = settings.get("provider", {})
    if native:
        cls = registry.engine_class(key)
        if getattr(cls, "provider_params_type", None) is None:
            raise ValueError("This model does not declare provider parameters")
        schema = cls.provider_params_type.model_json_schema()
        if "engine" in schema.get("required", []):
            # The routing discriminator is supplied by the selected model,
            # even when its typed params don't give that Literal a default.
            discriminator = schema.get("properties", {}).get("engine", {})
            identity = discriminator.get("const", registry.spec(key).engine_id)
            native = {"engine": identity, **native}
        values["provider_params"] = cls.provider_params_type.model_validate(native)
    return RuntimeParams(**values)


def artifact_context(registry, key, mode, request):
    from standard_asr.contract.artifacts import ArtifactContext

    return ArtifactContext(mode=mode, params=params_for(
        registry, key, request.get("models", {}).get(key, {})))


def detail(registry, key, request):
    from standard_asr import RuntimeParams, StreamDeadlines

    result = declarations(registry, key)
    if result["error"]:
        return dict(result, configSchema={}, paramsSchema={}, runtimeSchema={},
                    artifacts={}, artifactErrors={}, cacheRoot=None, deadlinesSchema={},
                    effectiveCapabilities=None, configurationError=None)
    cls = registry.engine_class(key)
    config = config_for(registry, key, request)
    result.update(configSchema=registry.config_schema(key) or {},
                  paramsSchema=cls.provider_params_type.model_json_schema()
                  if getattr(cls, "provider_params_type", None) else {},
                  runtimeSchema=RuntimeParams.model_json_schema(),
                  deadlinesSchema=StreamDeadlines.model_json_schema(),
                  artifacts={}, artifactErrors={}, cacheRoot=config.get("download_root"),
                  effectiveCapabilities=None, configurationError=None)
    try:
        engine = registry.create(key, **config)
        effective = getattr(engine, "effective_capabilities", cls.declared_capabilities)
        result["effectiveCapabilities"] = effective.canonical_json()
        result["dictation"] = dictation(engine.supports, engine.properties)
    except Exception as error:
        result["configurationError"] = error_message(error)
        return result
    for mode in ("batch", "streaming"):
        if result["capabilities"].get(mode) is None:
            continue
        try:
            report = engine.artifact_status(artifact_context(registry, key, mode, request))
            result["artifacts"][mode] = report.model_dump(mode="json")
        except Exception as error:
            result["artifactErrors"][mode] = error_message(error)
    return result


def stream_session(engine, session, ready=None):
    """Bind every plugin's session, including structural protocol implementations."""
    import standard_asr
    from standard_asr import SyncSession

    # Existing installations stay usable until the owner explicitly updates.
    # Current bootstrap always includes this native check; inventory discloses
    # when an older installed core cannot provide it yet.
    bind = getattr(standard_asr, "bind_session_capabilities", None)
    if bind is not None:
        bind(session, engine)
    with SyncSession(session) as sync:
        try:
            if ready is not None:
                ready(sync)
            failed = False
            for event in sync:
                emit("event", event.model_dump(mode="json"))
                if event.type == "error" and not event.recoverable:
                    failed = True
            if not failed:
                emit("transcript", sync.result().model_dump(mode="json"))
        finally:
            # Lifecycle/capability diagnostics are NOT in result.diagnostics.
            # Return them even on strict failures or exceptions during iteration.
            emit("diagnostics", [d.model_dump(mode="json") for d in sync.diagnostics()])


def listen(registry, request):
    """Run one real SDK session; stdin supplies PCM frames until end of audio."""
    import base64
    import numpy as np
    from standard_asr import AudioArray, AudioFormat, StreamDeadlines

    key = request["model"]
    engine = registry.create(key, **config_for(registry, key, request))
    settings = request.get("models", {}).get(key, {})
    chosen = dictation(engine.supports, engine.properties)
    incremental, mode = chosen["incremental"], chosen["mode"]
    guided = {field: value for field, value in request.get("guidance", {}).get(mode, {}).items()
              if engine.supports(mode + ".guidance." + field)}
    # User choices win over automatic workspace guidance.
    settings = dict(settings, options={**guided, **settings.get("options", {})})
    params = params_for(registry, key, settings)
    deadlines = StreamDeadlines(**settings.get("deadlines", {}))
    rate = request.get("sampleRate") or chosen["sampleRate"]

    def frames():
        for line in sys.stdin:
            message = json.loads(line)
            if message["kind"] == "end":
                return
            if message["kind"] == "audio":
                yield base64.b64decode(message["data"])

    if incremental:
        session = engine.start_transcription(
            audio_format=AudioFormat(encoding="pcm_s16le", sample_rate=rate, channels=1),
            params=params, deadlines=deadlines)
        def ready(sync):
            # Blocking stdin must stay off the SDK's event-loop thread.
            def send():
                try:
                    for chunk in frames():
                        sync.send_audio(chunk)
                    sync.end_audio()
                except Exception as error:
                    from standard_asr import StreamClosedError
                    if not isinstance(error, StreamClosedError):
                        emit("error", error_message(error))

            emit("ready", {"sampleRate": rate})
            threading.Thread(target=send, daemon=True).start()
        stream_session(engine, session, ready)
    else:
        if not engine.supports("batch") and not engine.supports("streaming_output"):
            raise ValueError("This engine has no usable PCM streaming or whole-audio mode")
        emit("ready", {"sampleRate": rate})
        audio = AudioArray(samples=np.frombuffer(b"".join(frames()), dtype="<i2").astype(np.float32) / 32768,
                           sample_rate=rate)
        if engine.supports("batch"):
            emit("transcript", engine.transcribe(audio, params).model_dump(mode="json"))
        else:
            stream_session(engine, engine.start_transcription(audio=audio, params=params, deadlines=deadlines))
    return None


def main(request):
    from standard_asr import discover_models

    registry = discover_models()
    command = request["command"]
    if command == "inventory":
        packages = [package(dist) for dist in metadata.distributions()]
        return {"core": next((p for p in packages if p["name"].lower().replace("_", "-")
                              == "standard-asr"), None),
                "plugins": [p for p in packages if p["engines"]], "packages": packages,
                "models": [declarations(registry, key) for key in registry.names()],
                "python": platform.python_version(), "runtime": runtime_features(),
                "diagnostics": ["Conflicting engine identity: " + name
                                for name in sorted(registry.shadowed_engine_ids)]}
    if command == "detail":
        return detail(registry, request["model"], request)
    if command == "validate":
        key = request["model"]
        cls = registry.engine_class(key)
        values = config_for(registry, key, request)
        engine = registry.create(key, **values)
        params = params_for(registry, key, request["models"][key])
        mode = dictation(engine.supports, engine.properties)["mode"]
        from standard_asr.runtime.gating import gate_params
        capabilities = getattr(engine, "effective_capabilities", cls.declared_capabilities)
        gate_params(params, capabilities, mode, strict=getattr(engine.config, "strict", True),
                    expected_provider_type=getattr(cls, "provider_params_type", None))
        from standard_asr import StreamDeadlines
        StreamDeadlines(**request["models"][key].get("deadlines", {}))
        return None
    if command == "acquire":
        key = request["model"]
        engine = registry.create(key, **config_for(registry, key, request))
        report = engine.acquire_artifacts(
            artifact_context(registry, key, request["mode"], request),
            refresh=request.get("refresh", False),
            progress=lambda value: emit("progress", value.model_dump(mode="json")))
        return report.model_dump(mode="json")
    if command == "listen":
        return listen(registry, request)
    raise ValueError("Unknown management command: " + command)


if __name__ == "__main__":
    request = json.loads(sys.stdin.readline())
    # Imported plugins sometimes print at import time. Keep the JSON channel clean.
    with contextlib.redirect_stdout(sys.stderr):
        try:
            emit("result", main(request))
        except Exception as error:
            report = getattr(error, "report", None)
            if report is not None:
                emit("artifactReport", report.model_dump(mode="json"))
            emit("error", {
                "message": error_message(error), "reason": getattr(error, "reason", None),
                "required_actions": [a.model_dump(mode="json") for a in getattr(error, "required_actions", [])],
                "retriable_after": getattr(error, "retriable_after", None),
            })
            sys.exit(1)

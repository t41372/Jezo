// The JavaScript side: register(key, modifiers, listener) and unregister().
// The OS reports presses and releases on its own schedule and thread, so they
// reach JavaScript through a thread-safe function.

#include <napi.h>

#include "platform.h"

namespace {

Napi::ThreadSafeFunction listener;

void Release() {
  PlatformUnregister();
  if (listener) {
    listener.Release();
    listener = nullptr;
  }
}

void Emit(bool pressed) {
  if (!listener) return;
  listener.NonBlockingCall([pressed](Napi::Env env, Napi::Function callback) {
    callback.Call({Napi::String::New(env, pressed ? "down" : "up")});
  });
}

// register(key: string, modifiers: {alt, cmd, ctrl, shift}, listener: (state) => void): string
// Returns "" when registered, or the reason it couldn't be.
Napi::Value Register(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 3 || !info[0].IsString() || !info[1].IsObject() || !info[2].IsFunction()) {
    Napi::TypeError::New(env, "register(key, modifiers, listener)").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  Release();

  Napi::Object modifiers = info[1].As<Napi::Object>();
  auto flag = [&](const char* name) { return modifiers.Get(name).ToBoolean().Value(); };
  Hotkey hotkey;
  hotkey.key = info[0].As<Napi::String>().Utf8Value();
  hotkey.alt = flag("alt");
  hotkey.cmd = flag("cmd");
  hotkey.ctrl = flag("ctrl");
  hotkey.shift = flag("shift");

  listener = Napi::ThreadSafeFunction::New(env, info[2].As<Napi::Function>(), "jezo-hotkey", 0, 1);
  // Don't keep the process alive just because a hotkey is registered.
  listener.Unref(env);

  std::string error = PlatformRegister(hotkey, Emit);
  if (!error.empty()) Release();
  return Napi::String::New(env, error);
}

Napi::Value Unregister(const Napi::CallbackInfo& info) {
  Release();
  return info.Env().Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("register", Napi::Function::New(env, Register));
  exports.Set("unregister", Napi::Function::New(env, Unregister));
  return exports;
}

}  // namespace

NODE_API_MODULE(hotkey, Init)

// macOS: the same Carbon hotkey API Chromium uses for globalShortcut, but
// listening for the release as well as the press. The OS consumes the key, so
// ⌥X doesn't type "≈" into the frontmost app, and no permission is needed.
// Modeled on tauri-apps/global-hotkey (src/platform_impl/macos).

#include <Carbon/Carbon.h>

#include <map>

#include "platform.h"

namespace {

constexpr OSType kSignature = 'jezo';

EventHotKeyRef hotkey_ref = nullptr;
EventHandlerRef handler_ref = nullptr;
OnChange on_change;

const std::map<std::string, UInt32> kKeyCodes = {
    {"A", kVK_ANSI_A}, {"B", kVK_ANSI_B}, {"C", kVK_ANSI_C}, {"D", kVK_ANSI_D}, {"E", kVK_ANSI_E},
    {"F", kVK_ANSI_F}, {"G", kVK_ANSI_G}, {"H", kVK_ANSI_H}, {"I", kVK_ANSI_I}, {"J", kVK_ANSI_J},
    {"K", kVK_ANSI_K}, {"L", kVK_ANSI_L}, {"M", kVK_ANSI_M}, {"N", kVK_ANSI_N}, {"O", kVK_ANSI_O},
    {"P", kVK_ANSI_P}, {"Q", kVK_ANSI_Q}, {"R", kVK_ANSI_R}, {"S", kVK_ANSI_S}, {"T", kVK_ANSI_T},
    {"U", kVK_ANSI_U}, {"V", kVK_ANSI_V}, {"W", kVK_ANSI_W}, {"X", kVK_ANSI_X}, {"Y", kVK_ANSI_Y},
    {"Z", kVK_ANSI_Z}, {"0", kVK_ANSI_0}, {"1", kVK_ANSI_1}, {"2", kVK_ANSI_2}, {"3", kVK_ANSI_3},
    {"4", kVK_ANSI_4}, {"5", kVK_ANSI_5}, {"6", kVK_ANSI_6}, {"7", kVK_ANSI_7}, {"8", kVK_ANSI_8},
    {"9", kVK_ANSI_9}, {"Space", kVK_Space},
};

OSStatus HandleHotkey(EventHandlerCallRef, EventRef event, void*) {
  EventHotKeyID id;
  if (GetEventParameter(event, kEventParamDirectObject, typeEventHotKeyID, nullptr, sizeof(id), nullptr, &id) != noErr ||
      id.signature != kSignature) {
    return eventNotHandledErr;  // Someone else's hotkey, such as Chromium's.
  }
  if (on_change) on_change(GetEventKind(event) == kEventHotKeyPressed);
  return noErr;
}

}  // namespace

std::string PlatformRegister(const Hotkey& hotkey, OnChange callback) {
  auto code = kKeyCodes.find(hotkey.key);
  if (code == kKeyCodes.end()) return "unsupported key: " + hotkey.key;

  UInt32 modifiers = 0;
  if (hotkey.alt) modifiers |= optionKey;
  if (hotkey.cmd) modifiers |= cmdKey;
  if (hotkey.ctrl) modifiers |= controlKey;
  if (hotkey.shift) modifiers |= shiftKey;

  on_change = std::move(callback);
  const EventTypeSpec events[] = {
      {kEventClassKeyboard, kEventHotKeyPressed},
      {kEventClassKeyboard, kEventHotKeyReleased},
  };
  OSStatus status =
      InstallEventHandler(GetApplicationEventTarget(), NewEventHandlerUPP(HandleHotkey), 2, events, nullptr, &handler_ref);
  if (status != noErr) {
    PlatformUnregister();
    return "InstallEventHandler failed: " + std::to_string(status);
  }
  status = RegisterEventHotKey(code->second, modifiers, {kSignature, 1}, GetApplicationEventTarget(), 0, &hotkey_ref);
  if (status != noErr) {
    PlatformUnregister();
    return "RegisterEventHotKey failed: " + std::to_string(status);
  }
  return "";
}

void PlatformUnregister() {
  if (hotkey_ref) UnregisterEventHotKey(hotkey_ref);
  if (handler_ref) RemoveEventHandler(handler_ref);
  hotkey_ref = nullptr;
  handler_ref = nullptr;
  on_change = nullptr;
}

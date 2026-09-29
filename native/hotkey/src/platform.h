// What each OS provides: register one hotkey and report every press and
// release of it. The callback may be called on any thread.

#pragma once

#include <functional>
#include <string>

struct Hotkey {
  // One key: "A"–"Z", "0"–"9", or "Space".
  std::string key;
  bool alt = false;
  bool cmd = false;  // Command on macOS, the Windows key on Windows.
  bool ctrl = false;
  bool shift = false;
};

using OnChange = std::function<void(bool pressed)>;

// Returns an empty string on success, or why it failed.
std::string PlatformRegister(const Hotkey& hotkey, OnChange on_change);
void PlatformUnregister();

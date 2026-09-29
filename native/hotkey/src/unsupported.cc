// Other platforms have no native hotkey yet. The app falls back to Electron's
// globalShortcut, which reports presses only, so ⌥X can't be held for voice there.

#include "platform.h"

std::string PlatformRegister(const Hotkey&, OnChange) { return "not supported on this platform"; }
void PlatformUnregister() {}

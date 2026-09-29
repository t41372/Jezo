// Windows: RegisterHotKey reports only the press, so after a press we poll the
// key until it's released. MOD_NOREPEAT stops auto-repeat from reporting more
// presses while it's held. The OS consumes the key, and no permission is needed.
// Modeled on tauri-apps/global-hotkey (src/platform_impl/windows).
//
// Untested: written on macOS without a Windows build. See docs/design/frontend.md.

#include <windows.h>

#include <atomic>
#include <future>
#include <thread>

#include "platform.h"

namespace {

constexpr int kHotkeyId = 1;
constexpr DWORD kPollMs = 50;

std::thread worker;
std::atomic<DWORD> worker_id{0};
std::atomic<bool> stopping{false};

UINT VirtualKey(const std::string& key) {
  if (key == "Space") return VK_SPACE;
  if (key.size() == 1 && ((key[0] >= 'A' && key[0] <= 'Z') || (key[0] >= '0' && key[0] <= '9'))) return key[0];
  return 0;
}

}  // namespace

std::string PlatformRegister(const Hotkey& hotkey, OnChange on_change) {
  UINT vk = VirtualKey(hotkey.key);
  if (!vk) return "unsupported key: " + hotkey.key;

  UINT modifiers = MOD_NOREPEAT;
  if (hotkey.alt) modifiers |= MOD_ALT;
  if (hotkey.cmd) modifiers |= MOD_WIN;
  if (hotkey.ctrl) modifiers |= MOD_CONTROL;
  if (hotkey.shift) modifiers |= MOD_SHIFT;

  // The hotkey belongs to the thread that registers it, and that thread must
  // run a message loop, so it gets a thread of its own.
  std::promise<std::string> registered;
  std::future<std::string> result = registered.get_future();
  stopping = false;
  worker = std::thread([vk, modifiers, on_change, &registered] {
    // Create this thread's message queue now, so PostThreadMessage can't miss it.
    MSG queue;
    PeekMessage(&queue, nullptr, WM_USER, WM_USER, PM_NOREMOVE);
    worker_id = GetCurrentThreadId();
    if (!RegisterHotKey(nullptr, kHotkeyId, modifiers, vk)) {
      registered.set_value("RegisterHotKey failed: " + std::to_string(GetLastError()));
      return;
    }
    registered.set_value("");
    MSG msg;
    while (GetMessage(&msg, nullptr, 0, 0) > 0) {
      if (msg.message != WM_HOTKEY || msg.wParam != kHotkeyId) continue;
      on_change(true);
      while (!stopping && (GetAsyncKeyState(vk) & 0x8000)) Sleep(kPollMs);
      on_change(false);
    }
    UnregisterHotKey(nullptr, kHotkeyId);
  });

  std::string error = result.get();
  if (!error.empty()) {
    worker.join();
    worker_id = 0;
  }
  return error;
}

void PlatformUnregister() {
  if (!worker.joinable()) return;
  stopping = true;
  PostThreadMessage(worker_id, WM_QUIT, 0, 0);
  worker.join();
  worker_id = 0;
}

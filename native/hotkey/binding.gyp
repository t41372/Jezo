{
  "targets": [
    {
      "target_name": "hotkey",
      "sources": ["src/addon.cc"],
      "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS", "NAPI_VERSION=8"],
      "conditions": [
        ["OS=='mac'", {
          "sources": ["src/mac.cc"],
          "link_settings": { "libraries": ["-framework Carbon"] },
          "xcode_settings": { "MACOSX_DEPLOYMENT_TARGET": "11.0", "CLANG_CXX_LANGUAGE_STANDARD": "c++20" }
        }],
        ["OS=='win'", {
          "sources": ["src/win.cc"],
          "msvs_settings": { "VCCLCompilerTool": { "AdditionalOptions": ["/std:c++20"] } }
        }],
        ["OS!='mac' and OS!='win'", { "sources": ["src/unsupported.cc"] }]
      ]
    }
  ]
}

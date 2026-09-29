# Jezo
AI native todo, goal, life manager to let you focus on the present

## Development

Needs [Bun](https://bun.sh), and a C++ toolchain for the ⌥X key module (Xcode Command Line Tools on macOS, Visual Studio Build Tools on Windows).

```sh
bun install
bun run dev        # the app, with hot reload
bun run typecheck
bun run package    # an unsigned app in dist/
```

The UI is being prototyped against mock data; see [docs/design/frontend.md](docs/design/frontend.md).

<p align="center"><img src="docs/brand/icon.svg" width="128" alt=""></p>

<h1 align="center">Jezo</h1>

<p align="center">A local-first personal agent that helps turn your goals into plans and follow-through so you can focus on the present.</p>

The name comes from 節奏 (jiézòu), Chinese for rhythm.

## Development

Needs [Bun](https://bun.sh), and a C++ toolchain for the ⌥X key module (Xcode Command Line Tools on macOS, Visual Studio Build Tools on Windows).

```sh
bun install
bun run dev        # the app, with hot reload
bun run typecheck
bun run package    # an unsigned app in dist/
```

The UI is being prototyped against mock data; see [docs/design/frontend.md](docs/design/frontend.md).

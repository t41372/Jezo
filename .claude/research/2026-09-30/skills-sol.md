Implemented and left uncommitted.

- Changed the skill parser/installer, IPC and bridge, agent tool and undo, methods UI, both locales, workspace template, design docs, and E2E tests.
- Passed typecheck/i18n, production build, 57 main tests, 15 memory tests, and real-file/local-server installer and tool checks.
- GUI E2E was blocked at Electron launch by sandbox `SIGABRT`/`EPERM`. GUI and local-model agent E2E still need a maintainer run.

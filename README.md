# dsh-computer-use

Self-contained DeepSeek Harness plugin that gives the agent **computer use**: read windows,
click, type, and screenshot any desktop app — through the computer-use runtime of the locally
installed **ChatGPT desktop app**. macOS (Apple Silicon) only.

It vendors only the macOS launch path of the original computer-use integration: it drops the
multi-platform host, the setup/update machinery, and any separate CLI, and reuses the CUA runtime
of the installed ChatGPT app in place (never copied or re-signed).

## Prerequisites

- macOS on Apple Silicon.
- The official **ChatGPT** desktop app installed at `/Applications/ChatGPT.app` (supplies the
  original CUA runtime). The plugin reads it in place; it never downloads or modifies it.
- DeepSeek Harness `>=0.2.1-rc.2 <0.3`.

## How it works

```
DSH Host process (plugin)
  └─ spawns <app>/Contents/Resources/cua_node/bin/node  runtime/launcher.mjs
       ├─ resolveInstalledMacApp()      validate ChatGPT.app (signature/team/arch/manifest)
       ├─ environment()                 build the CUA REPL's env (NODE_REPL_*/SKY_*)
       ├─ configureMacosLifecycle()     wrap Sky with runtime/macos_sky_service.mjs (turn-ended hook)
       ├─ startOriginalHost()           lifetime socket + control bridge (runtime/macos_host.mjs)
       └─ spawn the original cua-repl.mjs (the stdio MCP server) with inherited stdio
```

The plugin then talks MCP to the CUA REPL and registers its `js` / `js_reset` tools on DSH's
tool registry, injects the runtime's instructions as a system-prompt section, forwards native-app
approvals through DSH's question card, and ends each turn upstream (`Stop`/`Interrupt`) on DSH's
`turn/end`.

## Config

The bundle patch inserts one row with a single option:

```yaml
appPath: /Applications/ChatGPT.app   # path to the installed ChatGPT app
```

## Vendored dependency

`@modelcontextprotocol/sdk@1.30.0` is vendored under `node_modules/` because DSH links local
bundles (`link:`) and does not install their npm `dependencies`. DSH ships the newer
`@modelcontextprotocol/client` (v2); `adapters/client.mjs` is written against the v1 SDK, so the
v1 SDK is pinned and committed here. If you move to a `file:` install or publish to npm,
`dependencies` in `package.json` already declares the correct version.

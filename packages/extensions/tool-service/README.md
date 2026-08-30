# @deepseek-ai/dsh-tool-service

English | [中文](README.zh.md)

A model-facing `service_manage` tool for long-running processes that a session must keep alive (dev servers, watchers, mock APIs): start, stop, status, logs, and list. Every process the tool starts is a detached child tracked in a per-plugin registry with a private log file, and it is killed when its owning session disposes or the plugin unloads — the guarantee that prevents the orphaned-server failure mode where an agent's replacement process outlives the session that started it.

## What it does

- `start` spawns the command detached with its stdout/stderr captured to a private log, optionally asserting a port is free first and polling a healthcheck URL.
- `stop` terminates the process (SIGTERM, then SIGKILL after a grace period) and forgets it.
- `status` reports liveness, port state, and healthcheck result.
- `logs` returns the log tail.
- `list` enumerates managed services.

Starting a service requires an agent session (the lifecycle owner); agent-less starts are denied. A session's disposal kills the services it started, and plugin disposal kills everything.

## Config

```yaml
- id: tool-service
  name: '@deepseek-ai/dsh-tool-service'
  config:
    maxLogLines: 200
```

## Model Experience

### Service lifecycle result

#### What the model sees

Each call returns a short text confirmation: the started pid and log path, the stop acknowledgement, the status facts per service (`running`/`stopped`, `port:N(in use|free)`, `health:ok|down`), the log tail, or `no managed services`.

##### Result examples

```markdown
service "svc" started (pid 1234); logs at /var/folders/.../dsh-services/svc.log
- svc (pid 1234, running, port:3000(in use), health:ok)
```

#### Token effect

Result text is visible for that call and retained in history until compaction; the tool never streams process output.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **One shell process per service** — `start` runs the command through the shell as a single child; a process that daemonizes and re-executes is tracked by its first pid only.
- **Loopback healthchecks** — the healthcheck uses the harness fetch and does not verify the target address against SSRF rules; it is intended for local dev servers.
- **No restart or scale** — a stopped service is forgotten; there is no supervised restart or replica management.
- **Logs are process-local** — the log files live under the OS temp directory and are not persisted across a harness restart.

# @deepseek-ai/dsh-tool-service

[English](README.md) | 中文

面向模型的 `service_manage` 工具，管理会话需长期保持运行的进程（开发服务器、watcher、mock API）：start、stop、status、logs、list。工具启动的每个进程都是注册表中的分离子进程，带私有日志文件；当所属会话销毁或插件卸载时会被杀死——这正是不再重演"agent 启动的替代服务器成为无主进程、比启动它的会话活得更久"这一故障模式的关键保证。

## 功能

- `start` 分离启动命令，stdout/stderr 写入私有日志；可先断言端口空闲，并轮询健康检查 URL。
- `stop` 终止进程（先 SIGTERM，宽限期后 SIGKILL）并从注册表移除。
- `status` 报告存活、端口状态与健康检查结果。
- `logs` 返回日志尾部。
- `list` 枚举已管理服务。

启动服务必须有 agent 会话（生命周期所有者）；无 agent 的启动会被拒绝。会话销毁会杀死其启动的服务，插件卸载杀死全部。

## 配置

```yaml
- id: tool-service
  name: '@deepseek-ai/dsh-tool-service'
  config:
    maxLogLines: 200
```

## 模型体验

### 服务生命周期结果

#### 模型看到的内容

每次调用返回简短文本确认：启动的 pid 与日志路径、停止确认、每个服务的状态事实（`running`/`stopped`、`port:N(in use|free)`、`health:ok|down`）、日志尾部，或 `no managed services`。

##### 结果示例

```markdown
service "svc" started (pid 1234); logs at /var/folders/.../dsh-services/svc.log
- svc (pid 1234, running, port:3000(in use), health:ok)
```

#### Token 影响

结果文本对该次调用可见，并保留在历史中直到压缩；工具从不流式输出进程内容。

#### KV Cache 影响

仅追加；新可见内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

## 已知限制与暂缓事项

- **每个服务一个 shell 进程** —— `start` 通过 shell 以单一子进程运行命令；会守护化并重新 exec 的进程只跟踪其首个 pid。
- **仅回环健康检查** —— 健康检查使用 harness fetch，不按 SSRF 规则校验目标地址；适用于本地开发服务器。
- **无重启与扩缩** —— 停止的服务即被遗忘；没有受监督重启或副本管理。
- **日志仅进程本地** —— 日志文件位于操作系统临时目录，harness 重启后不持久。

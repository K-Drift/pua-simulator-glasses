# PUA Simulator Dify Agents

这是大厂模拟器的 Dify agent 编排与网关代码包。它从当前运行项目中复制出来，适合上传到 GitHub；运行中的本地项目、Dify 容器、SSH 隧道和 HTTPS 代理没有被改动。

## 目录

- `gateway/`: 对外接口网关，负责把 RTC / OpenAI-style 请求转成 Dify chat-messages，并处理 KPI 创建、维护、记忆、回传。
- `scripts/setup-dify-agents.ps1`: 本地 Dify agent、知识库、模型配置初始化脚本。
- `scripts/start-kpi-*.ps1`: 本地网关、HTTPS 代理、SSH/Cloudflared 中转启动脚本。
- `docs/`: 当前 agent 清单、调用说明、模型配置记录。
- `templates/`: 需要自行填值的配置模板。
- `certs/` 和 `secrets/`: 只放说明，不包含真实证书、私钥或 API key。

## 当前链路

- `kpi-create`: KPI 创建链路。保留当前轮对话记忆，用户给出明确目标后可收口为三条 KPI；生成成功后回传 KPI，并在流式内容末尾输出 `结束`。
- `kpi-fix`: KPI 维护链路。它是自由对话式老板人格 agent，有会话记忆和已设定 KPI 上下文；只有用户表达结束、关闭、先这样等意图时，才输出结束标记并检查本轮是否需要更新 KPI。
- `voicechat/kpi-create` 和 `voicechat/kpi-fix`: 面向火山 RTC CustomLLM 的 SSE 文本输出接口。

## 本地运行准备

1. 安装 Node.js。
2. 安装依赖：

```powershell
npm install
```

3. 准备 Dify，并运行 `scripts/setup-dify-agents.ps1` 创建 agent 与知识库。
4. 根据 `templates/dify-local-credentials.example.txt` 创建真实凭据文件。
5. 根据 `templates/env.example` 设置环境变量，或沿用脚本里的默认路径。
6. 如需 HTTPS/SSH 中转，把证书、私钥、SSH key 放到本机，但不要提交到 GitHub。

## 重要环境变量

- `KPI_GATEWAY_PORT`: 本地网关端口，默认 `8787`。
- `DIFY_BASE_URL`: Dify 地址，默认 `http://localhost:8080`。
- `DIFY_CREDENTIAL_PATH`: Dify app key 凭据文件路径。
- `KPI_GATEWAY_SECRET_PATH`: 网关调用 key 文件路径。
- `KPI_FINALIZED_LOG_PATH`: 本地 KPI 回调日志路径。
- `KPI_POST_URL`: KPI 三点回传接口。
- `KPI_POST_BEARER_TOKEN`: KPI 回传接口如需鉴权，可填 bearer token。
- `KPI_HTTPS_PORT`: 本地 HTTPS 代理端口，默认 `8788`。
- `KPI_TLS_CERT`: HTTPS 代理证书路径。
- `KPI_TLS_KEY`: HTTPS 代理证书私钥路径。

## 不包含的内容

这个包故意不包含：

- `node_modules/`
- Dify 运行目录和 Dify 安装压缩包
- 本地日志与 KPI 落库日志
- 真实 Dify app API key、dataset key、gateway key
- SSH 私钥
- TLS 证书私钥
- Cloudflare tunnel credential

上传 GitHub 前可以再运行一次：

```powershell
rg -n "sk-|app-[A-Za-z0-9]{20,}|BEGIN OPENSSH PRIVATE KEY|BEGIN PRIVATE KEY" .
```

如果没有输出敏感值，就可以提交。

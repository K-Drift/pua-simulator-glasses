# Secrets

This project needs local secret files, but they are intentionally not included in the GitHub package.

Typical local files:

- `dify-local-credentials.txt`: Dify admin info, dataset key, app API keys.
- `kpi-agent-gateway-key.txt`: gateway bearer key.
- `kpi-relay_ed25519`: SSH key for reverse relay.
- Cloudflare tunnel credential JSON, if Cloudflared is used.

Keep these outside Git history and reference them with environment variables.

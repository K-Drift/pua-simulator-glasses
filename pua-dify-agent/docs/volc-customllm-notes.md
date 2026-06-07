# Volc RTC CustomLLM Notes

The gateway exposes text-only SSE endpoints for Volc RTC CustomLLM.

Recommended endpoints:

- KPI create: `/voicechat/kpi-create`
- KPI fix/free chat: `/voicechat/kpi-fix`

Use HTTPS when configuring RTC if the platform rejects plain HTTP. The gateway output is text deltas in OpenAI-compatible SSE form, with a final stop chunk and `[DONE]`.

For `kpi-create`, final output appends `结束` so RTC can close the turn.

For `kpi-fix`, normal chat does not append an exit marker. When the user clearly says to close or finish the conversation, the gateway asks Dify to answer naturally, appends `结束`, then checks whether this round changed KPI points. If KPI changed, the gateway POSTs updated `points` to `KPI_POST_URL`.

# Dify Local API Quickstart

Local Dify URL: `http://localhost:8080`

All secrets are stored in `E:\PUAsimulator\dify-local-credentials.txt`.
Do not commit that file.

## Apps

- `chat_gateway`: normal chat app, supports `blocking` and `streaming`, with memory datasets attached.
- `agent_gateway`: Agent Chat app. Dify 1.14 Agent Chat Service API supports `streaming` only.
- `mayun_boss_persona`: boss-persona feedback app, `blocking` or `streaming`.
- `kpi_agent`: KPI/KR generation and follow-up app, `blocking` or `streaming`.
- `defense_work_report`: defense/work-report pressure interview app, `blocking` or `streaming`.
- `department_group_notice`: event-to-group-notice app with Qwen-VL image input enabled, `blocking` or `streaming`.
- `evaluation_report`: evaluation/closure report app with Qwen-VL image input enabled, `blocking` or `streaming`.

For the five Feishu-design apps, see `E:\PUAsimulator\dify-agent-manifest.md`.

## Call chat_gateway

```bash
curl -X POST http://localhost:8080/v1/chat-messages \
  -H "Authorization: Bearer <CHAT_GATEWAY_APP_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "inputs": {},
    "query": "Say in one sentence whether API calls are ready.",
    "response_mode": "blocking",
    "user": "local-user"
  }'
```

## Call agent_gateway

```bash
curl -N -X POST http://localhost:8080/v1/chat-messages \
  -H "Authorization: Bearer <AGENT_GATEWAY_APP_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "inputs": {},
    "query": "Your task here",
    "response_mode": "streaming",
    "user": "local-user"
  }'
```

## Write Long-Term Memory

Profile memory dataset:
`528145c9-de0e-412b-b7ea-176aed075fc9`

Event memory dataset:
`d0bb3960-b634-4605-b939-ee41f3affd44`

```bash
curl -X POST http://localhost:8080/v1/datasets/<DATASET_ID>/document/create-by-text \
  -H "Authorization: Bearer <DATASET_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "memory-2026-06-06",
    "text": "Write the long-term memory content here.",
    "doc_language": "English",
    "indexing_technique": "high_quality",
    "process_rule": {
      "mode": "automatic"
    }
  }'
```

## Feishu Agent Build

The Feishu-design agent group has been generated locally. App keys are stored in
`E:\PUAsimulator\dify-local-credentials.txt`; the non-secret manifest is in
`E:\PUAsimulator\dify-agent-manifest.md`.

## KPI Gateway Create/Fix Modes

The public KPI gateway supports a multi-turn KPI session layer on top of Dify.
It is used by the big-company simulator, so goals are not limited to business
metrics. School/student goals such as papers, exams, homework, clubs,
internships, interviews, and study plans are also treated as valid KPI targets.

- `POST /kpi-fix/chat`: KPI maintenance mode. Pass the same `session_id` across turns. After KPI is finalized, the gateway keeps the submitted KPI in memory for later employee challenge / boss adjustment.
- `POST /kpi-create/chat`: KPI creation mode. Pass the same `session_id` only for the current creation round. After KPI is finalized and submitted, the gateway forgets the stored KPI state for later calls.
- `POST /kpi/chat`: legacy alias for `POST /kpi-fix/chat`.
- `GET /kpi/sessions`: inspect in-memory KPI sessions.
- `GET /kpi/finalized`: inspect finalized KPI submissions.
- `POST /kpi/sessions/<session_id>/stop`: manually close a KPI session.

When Dify's raw assistant answer contains exactly three lines in this internal
format, the gateway closes the session, calls Dify's stop API, POSTs KPI points
to `KPI_POST_URL`, then calls `RTC_EXIT_URL`:

```text
第一条 指标短句 数据 口径基线目标周期
第二条 指标短句 数据 口径基线目标周期
第三条 指标短句 数据 口径基线目标周期
```

The gateway removes the separator word from RTC streaming output, so RTC receives
the readable version without `数据`. The KPI callback payload can still contain
numbers and symbols.

If the user gives a clear business goal, the gateway prompt treats the request as
ready to finalize. Missing baselines, target values, periods, owners, or review
cadence are filled with boss-style temporary values instead of asking repeated
detail questions. The assistant should ask only when the user gives no business
goal at all.

RTC speech is hard-limited by the gateway:

- ordinary non-KPI replies: up to 45 visible characters
- KPI creation/update recap: up to 60 visible characters

The callback `points` payload is not truncated.

Default business callbacks:

- `KPI_POST_URL`: `http://www.yhaox.top:18091/kpi`
- `RTC_EXIT_URL`: `http://www.yhaox.top:18091/glasses/rtc/exit`

The KPI callback payload is:

```json
{
  "points": [
    "次留稳住新客 次日留存 28%→35%，7天后给我汇报",
    "回访拉起入口 首登引导完成率 42%→55%，7天后我要看到结果",
    "流失点日清零 每日复盘 Top3 流失路径，每天给我看进展"
  ]
}
```

Local callback logs remain available at `GET /kpi/finalized`.

### Post-Final KPI Challenge

After a session has been finalized, calling `POST /kpi-fix/chat` again with the same
`session_id` enters boss review / escalation mode. The gateway injects the
submitted KPI into the agent context, so employee questions such as “这个目标太高”
or “资源不够怎么办” are answered against the existing KPI.

In `kpi-fix`, unclear edits such as “我没想好，你看着改” still produce updated
KPI points. When three updated KPI lines are generated, the gateway records
`kpi.escalated`, POSTs the updated `points`, and calls `RTC_EXIT_URL` again.

`POST /kpi-create/chat` does not enter this post-final mode. It submits the KPI
and then drops the stored final KPI state, so the same `session_id` starts fresh
unless the caller keeps sending the prior conversation explicitly.

If the response contains three updated KPI lines, the gateway records a
`kpi.escalated` event and POSTs updated `points` to `KPI_POST_URL` again, then calls `RTC_EXIT_URL`.

```bash
curl -N -X POST "$URL" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "kpi_agent",
    "stream": true,
    "session_id": "'"$SESSION"'",
    "user": "demo-user",
    "messages": [
      {
        "role": "user",
        "content": "这个 KPI 太高了，资源不够，我想跟老板解释一下。"
      }
    ]
  }'
```

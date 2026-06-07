# Dify Agent Manifest

Base URL: http://localhost:8080
Service API endpoint: http://localhost:8080/v1/chat-messages
Credentials file: E:\PUAsimulator\dify-local-credentials.txt

Do not paste secrets into source code. Read the matching `App API key` from the credentials file.

## Apps

All five Feishu-design apps inherit the same boss-persona base style: customer value first, result orientation, ownership pressure, measurable follow-up, and safe parody boundaries.

| App | App ID | Model | Image input | Key prefix |
| --- | --- | --- | --- | --- |
| mayun_boss_persona | 65600e3c-e60f-42dd-98af-e397ac916c0b | Qwen/Qwen3.5-35B-A3B | no | app-0w9WfYF5... |
| kpi_agent | 1c3ebb94-d261-470b-9027-c570316899fe | Qwen/Qwen3.5-35B-A3B | no | app-47TXIW4R... |
| defense_work_report | 83634db0-450c-44f6-9e84-1ea84aa5f610 | Qwen/Qwen3.5-35B-A3B | no | app-YYgUbIlr... |
| department_group_notice | 4a72ba31-8984-4e03-9cc8-3be4af75967c | Qwen/Qwen3-VL-8B-Instruct | yes | app-zHQRNPr2... |
| evaluation_report | 401e1229-325e-4bc1-b156-a0107995ec6c | Qwen/Qwen3-VL-8B-Instruct | yes | app-dUtlsfeB... |

## Knowledge Bases

| Dataset | Dataset ID | Purpose |
| --- | --- | --- |
| kb_a_boss_persona_public | 4ef241b9-323e-4540-90eb-88539e493b36 | Public Alibaba/Jack-Ma-style values and safe parody expression patterns |
| kb_b_alibaba_interview | 047fff4d-656f-4507-9ffc-470f8bd3aace | Public interview/workplace experience patterns, de-identified and summarized |
| kb_c_project_scenarios | 47c464a1-1947-4735-8cbc-bee1dbf44ef7 | KPI, defense, notice, evaluation, and memory-write scenario patterns |
| kb_news_alibaba_ai_cloud | 05bbae06-646e-41e0-8fd4-9e63d43f5e1e | Alibaba AI/cloud/Qwen public news summaries |
| kb_d_boss_insight_db | a0a4c9ed-88bc-4e65-9272-75cecb1fb2df | Real-source insight DB for management pressure, natural voice, and burst-point phrasing |
| kb_e_employee_sentiment | 64438b89-ee2a-4d5c-827f-e88ce2d3aa99 | Anonymized public employee review themes for pressure, fairness, management, benefits, and work-life tradeoffs |
| agent_profile_memory | 528145c9-de0e-412b-b7ea-176aed075fc9 | Long-term user/profile memory |
| agent_event_memory | d0bb3960-b634-4605-b939-ee41f3affd44 | Long-term event memory |

## Service API Call

## Volcengine-compatible KPI Endpoint

Public endpoint:

```text
https://venue-annotated-courtesy-lease.trycloudflare.com/kpi/chat
```

This endpoint accepts an OpenAI-style chat request body for Volcengine RTC CustomLLM integration:

```json
{
  "messages": [
    {
      "role": "user",
      "content": "目标：提升新用户次日留存。请用老板画饼式风格设定 KPI，并追问我。"
    }
  ],
  "stream": true,
  "temperature": 0.1,
  "max_tokens": 100,
  "top_p": 0.9,
  "model": "kpi-agent",
  "stream_options": {
    "include_usage": true
  }
}
```

It returns `Content-Type: text/event-stream`, OpenAI-style `chat.completion.chunk` SSE events, and terminates each response with:

```text
data: [DONE]
```

The gateway also still accepts legacy `{ "query": "..." }` request bodies, but Volcengine should use `messages`.

## Dify Service API Call

```powershell
$token = "<App API key from dify-local-credentials.txt>"
$headers = @{ Authorization = "Bearer $token" }
$body = @{
  inputs = @{}
  query = "员工在会议中一直看手机，请给一个自然、有压力但不羞辱人的老板点评。"
  response_mode = "blocking"
  user = "local-user"
} | ConvertTo-Json -Depth 20
$bytes = [Text.Encoding]::UTF8.GetBytes($body)
Invoke-RestMethod -Uri "http://localhost:8080/v1/chat-messages" -Method Post -Headers $headers -ContentType "application/json; charset=utf-8" -Body $bytes
```

## Memory Write API

Use the dataset API key in `dify-local-credentials.txt`.

```powershell
$datasetId = "d0bb3960-b634-4605-b939-ee41f3affd44"
$datasetToken = "<Dataset API key from dify-local-credentials.txt>"
$headers = @{ Authorization = "Bearer $datasetToken" }
$body = @{
  name = "event_memory_2026_06_06_example"
  text = "user_id: local-user`nevent: ...`nsummary: ...`nwrite_reason: stable_or_important_event"
  doc_language = "Chinese"
  doc_form = "text_model"
  indexing_technique = "high_quality"
  process_rule = @{ mode = "automatic" }
} | ConvertTo-Json -Depth 20
$bytes = [Text.Encoding]::UTF8.GetBytes($body)
Invoke-RestMethod -Uri "http://localhost:8080/v1/datasets/$datasetId/document/create-by-text" -Method Post -Headers $headers -ContentType "application/json; charset=utf-8" -Body $bytes
```

## Source Materials Seeded

- Alibaba official overview: https://www.alibabagroup.com/en-US/about/overview
- Alibaba ESG/social materials: https://esg.alibabagroup.com/social.html
- Alibaba AI/cloud investment and Qwen ecosystem public news:
  - https://home.alibabagroup.com/en-US/document-1830678592242057216
  - https://home.alibabagroup.com/en-US/document-1871720871488389120
  - https://alihome.alibaba-inc.com/en-US/document-1853940226976645120
  - https://www.alibabagroup.com/document-1991364841188622336
  - https://www.alibabagroup.com/en-US/document-1971445322303406080
  - https://www.alibabagroup.com/en-US/document-1993785120221298688
  - https://www.alibabagroup.com/en-US/document-1994119844504535040
  - https://www.alibabagroup.com/document-1911884625546838016
  - https://www.alibabagroup.com/document-1991231293551017984
  - https://www.alibabagroup.com/en-US/document-1907873420045975552
- Public Nowcoder interview experience summaries:
  - https://www.nowcoder.com/discuss/353156366837686272
  - https://www.nowcoder.com/discuss/633868
  - https://www.nowcoder.com/discuss/485324858339885056
  - https://www.nowcoder.com/discuss/430483812422791168
  - https://www.nowcoder.com/discuss/486904
  - https://www.nowcoder.com/discuss/433840

## Smoke Test

All five apps returned successful blocking responses through `/v1/chat-messages` on 2026-06-06.

## Enrichment Notes

The insight DB now contains additional material for:

- FY2026 cloud/AI growth converted into KPI pressure.
- KPI vision-selling / "画饼" boss style, with conditional opportunity framing and measurable verification.
- KPI two-sentence "暴论" style: about 45-75 Chinese chars, witty, natural, with controlled Ma Yun quote-meme triggers such as “996 是福报” used only as irony, and OpenAI/Volcengine streaming-compatible.
- KPI multi-turn finalization: records current-round conversation, asks for missing data, and finalizes only when 3 concise KPI items have data support.
- KPI post-final boss review: later calls with the same session include submitted KPI context, let employees question the KPI, and can produce `kpi.escalated` updates with higher targets.
- Huaming / nickname-culture texture: lightweight Alibaba-style role labels tied to responsibility, metrics, and action, with guardrails against real-identity claims or humiliating nicknames.
- Agentic AI and Qwen ecosystem converted into execution-style pressure.
- Qwen/Taobao productization converted into user-journey and closure pressure.
- Big-company meeting texture from public interview patterns.
- Evidence-grade rules for department notices and evaluation reports.
- Role-specific follow-up patterns for product, data, operations, and engineering.
- Anonymized employee-review themes from public platforms, used only as sentiment texture rather than company-wide fact.

const http = require("http");
const fs = require("fs");
const crypto = require("crypto");

const PORT = Number(process.env.KPI_GATEWAY_PORT || 8787);
const DIFY_BASE_URL = process.env.DIFY_BASE_URL || "http://localhost:8080";
const CREDENTIAL_PATH = process.env.DIFY_CREDENTIAL_PATH || "E:\\PUAsimulator\\dify-local-credentials.txt";
const GATEWAY_SECRET_PATH = process.env.KPI_GATEWAY_SECRET_PATH || "E:\\PUAsimulator\\kpi-agent-gateway-key.txt";
const FINALIZED_LOG_PATH = process.env.KPI_FINALIZED_LOG_PATH || "E:\\PUAsimulator\\kpi-finalized.jsonl";
const SESSION_TTL_MS = Number(process.env.KPI_SESSION_TTL_MS || 1000 * 60 * 60 * 6);
const DEFAULT_KPI_POST_URL = "http://www.yhaox.top:18091/kpi";
const RTC_EXIT_MARKER = "[[RTC_EXIT]]";

function readText(path) {
  return fs.readFileSync(path, "utf8");
}

function ensureGatewayKey() {
  if (fs.existsSync(GATEWAY_SECRET_PATH)) {
    const existing = readText(GATEWAY_SECRET_PATH).trim();
    if (existing) return existing;
  }
  const key = `kpi_${crypto.randomBytes(24).toString("base64url")}`;
  fs.writeFileSync(GATEWAY_SECRET_PATH, `${key}\n`, { encoding: "utf8", flag: "w" });
  return key;
}

function getDifyAppKey(appName) {
  const text = readText(CREDENTIAL_PATH);
  const escaped = appName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`App name:\\s*${escaped}\\s*\\r?\\nApp ID:.*?\\r?\\nApp API key:\\s*(app-[^\\r\\n]+)`, "s");
  const match = text.match(re);
  if (!match) throw new Error(`App key not found for ${appName}`);
  return match[1].trim();
}

const gatewayKey = ensureGatewayKey();
const kpiAppKey = getDifyAppKey("kpi_agent");
const KPI_POST_URL = process.env.KPI_POST_URL || DEFAULT_KPI_POST_URL;
const KPI_POST_BEARER_TOKEN = process.env.KPI_POST_BEARER_TOKEN || "";
const sessions = new Map();
const finalizedRecords = [];
const recentRequests = [];
const recentAccess = [];

function rememberRequest(record) {
  recentRequests.push({ at: nowIso(), ...record });
  while (recentRequests.length > 30) recentRequests.shift();
}

function sanitizeUrlForLog(url) {
  const cloned = new URL(url.toString());
  for (const key of ["api_key", "key", "x-api-key", "token"]) {
    if (cloned.searchParams.has(key)) cloned.searchParams.set(key, "***");
  }
  return `${cloned.pathname}${cloned.search}`;
}

function rememberAccess(req, url, extra = {}) {
  recentAccess.push({
    at: nowIso(),
    method: req.method,
    path: sanitizeUrlForLog(url),
    pathname: url.pathname,
    query_keys: [...url.searchParams.keys()],
    auth_header_present: Boolean(req.headers.authorization),
    x_api_key_present: Boolean(req.headers["x-api-key"]),
    query_key_present: Boolean(url.searchParams.get("api_key") || url.searchParams.get("key") || url.searchParams.get("x-api-key")),
    auth_ok: isAuthorized(req),
    content_type: req.headers["content-type"] || "",
    user_agent: req.headers["user-agent"] || "",
    remote_address: req.socket && req.socket.remoteAddress,
    ...extra,
  });
  while (recentAccess.length > 100) recentAccess.shift();
}

function normalizeKpiMode(mode) {
  return mode === "create" ? "create" : "fix";
}

function getSessionKey(sessionId, mode) {
  return `${normalizeKpiMode(mode)}:${sessionId}`;
}

function sendJson(res, code, body) {
  const data = Buffer.from(JSON.stringify(body, null, 2), "utf8");
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(data.length),
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "authorization,content-type,x-api-key",
  });
  res.end(data);
}

function sendError(res, code, errorCode, message) {
  sendJson(res, code, { Error: { Code: errorCode, Message: message } });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function isAuthorized(req) {
  const auth = req.headers.authorization || "";
  const apiKey = req.headers["x-api-key"] || "";
  let queryKey = "";
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    queryKey = url.searchParams.get("api_key") || url.searchParams.get("key") || url.searchParams.get("x-api-key") || "";
  } catch {
    queryKey = "";
  }
  return auth === `Bearer ${gatewayKey}` || apiKey === gatewayKey || queryKey === gatewayKey;
}

function nowIso() {
  return new Date().toISOString();
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || "");
}

function getClientUser(payload) {
  return String(payload.user || payload.end_user || "external-kpi-user");
}

function getSessionId(payload, user) {
  return String(
    payload.session_id ||
    payload.kpi_session_id ||
    payload.kpi_conversation_id ||
    payload.inputs?.session_id ||
    payload.inputs?.kpi_session_id ||
    payload.conversation_id ||
    user
  );
}

function getSession(sessionId, user, mode = "fix") {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.updatedAt > SESSION_TTL_MS) sessions.delete(id);
  }

  const sessionMode = normalizeKpiMode(mode);
  const key = getSessionKey(sessionId, sessionMode);
  let session = sessions.get(key);
  if (!session) {
    session = {
      key,
      id: sessionId,
      mode: sessionMode,
      user,
      createdAt: now,
      updatedAt: now,
      closed: false,
      turns: [],
      difyConversationId: null,
      lastTaskId: null,
      finalKpis: null,
      finalAnswer: null,
      escalations: [],
      dryRun: false,
      callback: null,
      stopResult: null,
    };
    sessions.set(key, session);
  }
  session.updatedAt = now;
  session.mode = sessionMode;
  session.user = user;
  return session;
}

function normalizeContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") return part.text || part.content || "";
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (content && typeof content === "object") {
    return (
      content.text ||
      content.content ||
      content.message ||
      content.query ||
      content.prompt ||
      content.input ||
      content.utterance ||
      content.transcript ||
      content.asr_text ||
      content.user_text ||
      content.sentence ||
      JSON.stringify(content)
    );
  }
  return "";
}

function extractLastUserText(payload) {
  const direct =
    payload.query ||
    payload.message ||
    payload.text ||
    payload.prompt ||
    payload.content ||
    payload.input ||
    payload.utterance ||
    payload.transcript ||
    payload.asr_text ||
    payload.user_text ||
    payload.sentence ||
    payload.inputs?.query ||
    payload.inputs?.message ||
    payload.inputs?.text ||
    payload.inputs?.prompt ||
    payload.inputs?.utterance ||
    payload.input?.query ||
    payload.input?.message ||
    payload.input?.text ||
    payload.input?.prompt ||
    payload.input?.utterance ||
    payload.Input?.Query ||
    payload.Input?.Message ||
    payload.Input?.Text ||
    payload.Input?.Prompt;
  if (direct) return normalizeContent(direct);
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const lastUser = [...messages].reverse().find((message) => message && (!message.role || message.role === "user"));
  return normalizeContent(lastUser && (lastUser.content || lastUser.text || lastUser.message || lastUser.query));
}

function hasActionableGoal(text) {
  const value = String(text || "");
  if (/不知道.*做什么|不知道要做什么|没有目标|没目标|随便聊|先跟我说说|可以听到吗|能听到吗|喂喂/.test(value)) return false;
  return /目标|提升|降低|增长|留存|转化|收入|营收|GMV|效率|成本|复购|活跃|DAU|MAU|CTR|满意度|投诉|交付|上线|修复|拍照|上传|展示|联调|项目|指标|KPI|没想好|帮我定|直接定|你来定|看着定|生成|希望|想要|想在|我要|需要|计划|打算|完成|做完|写完|定稿|论文|报告|方案|文档|作业|一周|本周|今天|明天|月底|周内|七天|天后|下周|周末|学校|学生|课程|上课|复习|预习|考试|期末|期中|成绩|分数|\d+\s*分|绩点|GPA|错题|刷题|题库|背书|背完|单词|英语|数学|语文|物理|化学|生物|地理|历史|政治|考到|考上|考过|四级|六级|雅思|托福|考研|答辩|毕设|课设|社团|班级|活动|简历|实习|面试/i.test(value);
}

function isStudentGoal(text) {
  return /学校|学生|课程|上课|复习|预习|考试|期末|期中|成绩|分数|\d+\s*分|绩点|GPA|错题|刷题|题库|背书|背完|单词|英语|数学|语文|物理|化学|生物|地理|历史|政治|考到|考上|考过|四级|六级|雅思|托福|考研|论文|报告|作业|答辩|毕设|课设|社团|班级|活动|简历|实习|面试|求职|校招|秋招|春招/i.test(text || "");
}

function getRecentUserGoalText(session, currentText) {
  const recent = (session && Array.isArray(session.turns) ? session.turns : [])
    .filter((turn) => turn && turn.role === "user" && turn.content)
    .slice(-4)
    .map((turn) => String(turn.content || ""));
  if (currentText && !recent.includes(currentText)) recent.push(String(currentText));
  return recent.join("\n");
}

function countActionableUserTurns(session) {
  return (session && Array.isArray(session.turns) ? session.turns : [])
    .filter((turn) => turn && turn.role === "user" && hasActionableGoal(turn.content))
    .length;
}

function hasFinalizeIntent(text) {
  return /直接定|直接生成|生成kpi|生成KPI|定kpi|定KPI|收口|拍板|就这样|可以了|不用问|马上定|现在定/i.test(text || "");
}

function isPaperGoal(text) {
  return /论文|报告|方案|文档|定稿|写作|答辩|毕设|毕业设计|开题|初稿|终稿|查重|导师|文献|正文|选题|课题/i.test(text || "");
}

function makeKpi(index, item, evidence) {
  return {
    index,
    item,
    evidence,
    text: `${item} ${evidence}`,
  };
}

function extractTargetNumber(text, units, fallback, maxValue = 100000) {
  const values = [];
  const regex = new RegExp(`(\\d{1,6})\\s*(?:${units})`, "gi");
  for (const match of String(text || "").matchAll(regex)) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0) values.push(Math.min(value, maxValue));
  }
  return values.length ? Math.max(...values) : fallback;
}

function synthesizeKpisFromGoal(text) {
  const source = String(text || "");
  if (/论文|报告|方案|文档|定稿|写作|答辩|毕设|毕业设计|开题|初稿|终稿|查重|导师|文献|正文|选题|课题/.test(source)) {
    const targetChars = extractTargetNumber(source, "字", 0, 100000);
    return [
      makeKpi(1, "论文主线定稿", "正文完成度 0%→100% 7天后我要看到定稿"),
      targetChars
        ? makeKpi(2, "每天写作推进", `累计字数 0字→${targetChars}字 每晚给我汇报`)
        : makeKpi(2, "每天三页推进", "日均产出 0页→3页 每晚给我汇报"),
      makeKpi(3, "卡点当天清零", "每日复盘 Top3 卡点 明天一早给我看"),
    ];
  }
  if (/考试|期末|期中|复习|成绩|分数|\d+\s*分|刷题|题库|错题|绩点|GPA|数学|语文|物理|化学|生物|地理|历史|政治|考到|考上|考过|考研|四级|六级|雅思|托福/.test(source)) {
    const targetScore = extractTargetNumber(source, "分", 85, 100);
    return [
      makeKpi(1, "复习主线打穿", "核心知识点完成度 40%→90% 7天后我要看到结果"),
      makeKpi(2, "错题当天清零", "每日复盘 Top3 错题类型 每晚给我汇报"),
      makeKpi(3, "模拟成绩抬头", `模拟分数 60分→${targetScore}分 7天后我要看到进步`),
    ];
  }
  if (/单词|背书|背完|英语|记忆|默写/.test(source)) {
    const targetWords = extractTargetNumber(source, "个|单词|词", 500, 5000);
    return [
      makeKpi(1, "单词库存拉满", `单词掌握量 0个→${targetWords}个 7天后我要看到结果`),
      makeKpi(2, "每天默写过关", "每日默写正确率 60%→90% 每晚给我汇报"),
      makeKpi(3, "遗忘当天补回", "错词 Top3 每天复盘 明天一早给我看"),
    ];
  }
  if (/作业|课程|课设|预习|上课|课堂|学习计划/.test(source)) {
    return [
      makeKpi(1, "作业准点交付", "完成度 0%→100% 3天后我要看到结果"),
      makeKpi(2, "知识点当天消化", "课程要点掌握率 50%→85% 每晚给我汇报"),
      makeKpi(3, "卡点不过夜", "每日 Top3 疑问清零 明天一早给我看"),
    ];
  }
  if (/论文|报告|方案|文档|定稿|写作/.test(source)) {
    const targetChars = extractTargetNumber(source, "字", 0, 100000);
    return [
      makeKpi(1, "论文主线定稿", "正文完成度 0%→100% 7天后我要看到定稿"),
      targetChars
        ? makeKpi(2, "每天写作推进", `累计字数 0字→${targetChars}字 每晚给我汇报`)
        : makeKpi(2, "每天三页推进", "日均产出 0页→3页 每晚给我汇报"),
      makeKpi(3, "卡点当天清零", "每日复盘 Top3 卡点 明天一早给我看"),
    ];
  }
  if (/社团|班级|活动|比赛|竞赛|志愿|组织/.test(source)) {
    const targetPeople = extractTargetNumber(source, "人", 30, 10000);
    return [
      makeKpi(1, "活动方案定稿", "方案完成度 0%→100% 3天后我要看到结果"),
      makeKpi(2, "报名转化拉起", `报名人数 0人→${targetPeople}人 7天后给我汇报`),
      makeKpi(3, "现场风险清零", "Top3 风险预案每天复盘 明天一早给我看"),
    ];
  }
  if (/简历|实习|面试|求职|offer|校招|秋招|春招/.test(source)) {
    const targetDeliveries = extractTargetNumber(source, "份|家", 20, 500);
    return [
      makeKpi(1, "简历当天打磨", "简历完成度 60%→95% 3天后我要看到结果"),
      makeKpi(2, "投递节奏拉满", `有效投递 0份→${targetDeliveries}份 7天后给我汇报`),
      makeKpi(3, "面试复盘闭环", "Top3 面试卡点每日清零 明天一早给我看"),
    ];
  }
  if (/留存|新用户|新客|次留|7日/.test(source)) {
    return [
      makeKpi(1, "次留稳住新客", "次日留存 28%→35% 7天后我要看到结果"),
      makeKpi(2, "首登拉起入口", "首登完成率 42%→55% 7天后我要看到进步"),
      makeKpi(3, "流失路径日清", "每日复盘 Top3 流失路径 明天一早给我汇报"),
    ];
  }
  if (/转化|漏斗|成交|下单|注册/.test(source)) {
    return [
      makeKpi(1, "转化漏斗打穿", "核心转化率 8%→12% 7天后我要看到结果"),
      makeKpi(2, "首屏动作提速", "关键动作完成率 45%→60% 7天后给我汇报"),
      makeKpi(3, "卡点当天清零", "每日复盘 Top3 流失卡点 明天一早给我看"),
    ];
  }
  if (/收入|营收|GMV|销售|客单|复购/.test(source)) {
    return [
      makeKpi(1, "收入目标抬头", "GMV 暂定提升 15% 30天后我要看到结果"),
      makeKpi(2, "客单转化拉升", "支付转化率 10%→13% 7天后给我汇报"),
      makeKpi(3, "高意向单跟紧", "Top3 客户机会每日复盘 明天一早给我看"),
    ];
  }
  if (/效率|成本|交付|上线|修复|联调|上传|展示|拍照/.test(source)) {
    return [
      makeKpi(1, "交付链路跑通", "核心流程完成率 70%→90% 7天后我要看到结果"),
      makeKpi(2, "阻塞当天清掉", "Top3 阻塞点每日闭环 明天一早给我看"),
      makeKpi(3, "返工压到最低", "返工率 15%→8% 7天后给我汇报"),
    ];
  }
  return [
    makeKpi(1, "目标结果达标", "暂定基线 60%→75% 7天后我要看到结果"),
    makeKpi(2, "关键动作跑通", "核心动作完成率 70%→85% 7天后给我汇报"),
    makeKpi(3, "复盘当天闭环", "每日复盘 Top3 问题 明天一早给我看"),
  ];
}

function bumpPercentText(text) {
  return String(text || "").replace(/(\d+(?:\.\d+)?)%\s*(?:→|到)\s*(\d+(?:\.\d+)?)%/g, (_, from, to) => {
    const current = Number(to);
    const bumped = Number.isFinite(current) ? Math.round(current * 1.1) : to;
    return `${from}%→${bumped}%`;
  });
}

function synthesizeEscalatedKpis(session) {
  const base = Array.isArray(session && session.finalKpis) ? session.finalKpis : [];
  if (base.length === 3) {
    return base.map((kpi, index) =>
      makeKpi(index + 1, kpi.item || `第${index + 1}条继续压实`, `${bumpPercentText(kpi.evidence || kpi.text)} 口径更硬 每日复盘`)
    );
  }
  return synthesizeKpisFromGoal("");
}

function formatRawKpis(kpis) {
  const names = ["", "一", "二", "三"];
  return (Array.isArray(kpis) ? kpis : [])
    .map((kpi, index) => `第${names[kpi.index || index + 1]}条 ${kpi.item} 数据 ${kpi.evidence}`)
    .join("\n");
}

function hasHuamingTrigger(text) {
  return /\u82b1\u540d|\u6c5f\u6e56|\u963f\u91cc\u5473|\u5c0f\u4e8c/.test(text || "");
}

function withHuamingRules(text) {
  if (!hasHuamingTrigger(text)) return text;
  return [
    "以下是实时对话上下文，请按老板式 KPI agent 的风格回复最后一条用户消息。",
    "用户可能在说内部文化或角色感。你只需要让话听起来有担当感和机会感，不要直接说内部设计词，不要输出引号或特殊符号。",
    "",
    `用户消息：${text}`,
  ].join("\n");
}

function formatSessionMemory(session) {
  const turns = session.turns.slice(-10);
  if (!turns.length) return "暂无。";
  return turns
    .map((turn) => {
      const content = String(turn.content || "").replace(/\s+/g, " ").slice(0, 240);
      return `${turn.role}: ${content}`;
    })
    .join("\n");
}

function withKpiSessionRules(text, session) {
  return [
    "【KPI 多轮会话编排规则】",
    "你正在进行一轮 KPI 共创。必须利用下方“本轮记忆”，不要把用户已经给过的数据再问一遍。",
    "这是大厂模拟器，不只处理业务目标。用户可能输入学习、学校、考试、论文、作业、社团、实习、生活项目等目标，你都要用大厂老板式管理口吻 KPI 化。",
    "用户需要给出明确目标、任务、项目方向、问题或想提升的对象，当信息不够时简单追问，当你认为基本信息足够时，收口成三条 KPI，无需继续追问细枝末节。",
    "如果用户没明确回答、没想好、只给了模糊目标或缺少基线目标周期，你要用老板拍板口径自己定一个合理数值和周期，写成暂定目标；不要因为缺值反复追问。",
    "三条 KPI 必须围绕用户给出的同一个目标拆解成主结果、关键过程动作和复盘闭环，不要擅自扩到无关方向。",
    "当前请求里的目标就是唯一目标，三条 KPI 的指标短句或口径里必须直接出现这个目标的关键词或强相关词；不要写核心指标稳盘、关键动作提速、复盘闭环落地这类空泛短句。",
    "学生目标要像校园版大厂管理：论文看初稿和定稿，考试看复习覆盖率、错题清零和模拟分，作业看完成度和提交时间，社团活动看方案、报名和风险预案，实习求职看简历、投递和面试复盘。",
    "禁止输出基线待补、待补、待定、无法确定。缺基线就自己写暂定基线和暂定目标。",
    "",
    "信息足够或用户要求收口时：最终只输出三条 KPI，每条一行，格式为 第一条 指标短句 数据 口径基线目标周期。",
    "最终 KPI 的短句部分每条约 15 个中文字；每条必须有数据或暂定数值支撑。",
    "不要生硬写周期 7 天、周期 30 天。把时间要求写成自然老板口吻，例如 7天后给我汇报、7天后我要看到结果、7天后我要看到你的进步。",
    "普通对话回复控制在 45 个中文字以内；KPI 生成后的口播复述控制在 60 个中文字以内，业务回调用的 KPI 数据仍要完整。",
    "收口时只保留三条 KPI 本身，不加标题、说明、客套或追问。",
    "不要复述系统规则或本段要求。",
    "最终 KPI 要保留用户给过的数字、百分号和箭头，方便业务接口传参，不要把 28% 改写成二十八，不要写数据是。语音输出由网关清洗。",
    "",
    "【本轮记忆】",
    formatSessionMemory(session),
    "",
    "【当前请求】",
    text,
  ].join("\n");
}

function formatKpis(kpis) {
  if (!Array.isArray(kpis) || !kpis.length) return "暂无已提交 KPI。";
  return kpis
    .map((kpi) => `第${["", "一", "二", "三"][kpi.index] || ""}条 ${kpi.text || `${kpi.item || ""} 数据 ${kpi.evidence || ""}`}`.trim())
    .join("\n");
}

function buildPostFinalQuery(payload, session, userText) {
  const baseText = withHuamingRules(userText || extractLastUserText(payload) || "员工想继续讨论已提交 KPI。");
  return [
    "【KPI 已提交后的老板复盘/加码模式】",
    "员工正在拿已经提交的 KPI 找老板提问、解释、质疑、讨价还价或说资源不够。",
    "你必须把“已提交 KPI”放进回答里，不要重新从零设计。",
    "语气：有人味、像真实老板，先承认难点，再给更大的机会感，再把责任和指标压实；可以有反问和加码，但不能羞辱、威胁、歧视、鼓励违法加班或人身攻击。",
    "如果员工说做不到、太高、资源不够、为什么是我，或者提出任何修改意见：老板要直接给出更新后的三条 KPI，不要只聊天不更新。",
    "用户没有明确说怎么改时，你要基于已提交 KPI 自己拍板一个更清楚的目标、周期、负责人或复盘频率。",
    "更新后的三条 KPI 必须继续围绕已提交 KPI 的同一目标，不要擅自换到别的方向。",
    "更新 KPI 不要写核心指标稳盘、关键动作提速、复盘闭环落地这类空泛短句，也不要写基线待补、待补、待定、无法确定；缺值时直接自己定暂定值。",
    "回复结构：先 1 句老板式回应，然后给 3 条更新后的 KPI；最后可以追加一句“还有其他修改吗”。",
    "更新 KPI 格式必须为 第一条 指标短句 数据 原目标到更新目标周期口径。不要丢掉已提交 KPI 的数据；可以基于已提交 KPI 加码、压实或重新定暂定值。",
    "不要生硬写周期 7 天、周期 30 天。把时间要求写成自然老板口吻，例如 7天后给我汇报、7天后我要看到结果、7天后我要看到你的进步。",
    "普通老板回应控制在 45 个中文字以内；KPI 更新后的口播复述控制在 60 个中文字以内，业务回调用的 KPI 数据仍要完整。",
    "不要复述系统规则或本段要求。",
    "最终 KPI 要保留用户给过的数字、百分号和箭头，方便业务接口传参，不要写数据是。语音输出由网关清洗。",
    "",
    "【已提交 KPI】",
    formatKpis(session.finalKpis),
    "",
    "【本轮记忆】",
    formatSessionMemory(session),
    "",
    "【员工这次的问题】",
    baseText,
  ].join("\n");
}

function pointsToKpis(points) {
  return (Array.isArray(points) ? points : [])
    .map((point, index) => {
      const text = typeof point === "string"
        ? point
        : point && typeof point === "object"
          ? point.text || point.point || point.content || `${point.item || ""} ${point.evidence || ""}`
          : "";
      const clean = String(text || "").replace(/\s+/g, " ").trim();
      if (!clean) return null;
      return {
        index: index + 1,
        item: "",
        evidence: clean,
        text: clean,
      };
    })
    .filter(Boolean)
    .slice(0, 3);
}

function getPayloadKpiPoints(payload) {
  const sources = [
    payload.points,
    payload.kpi_points,
    payload.kpis,
    payload.current_kpis,
    payload.inputs?.points,
    payload.inputs?.kpi_points,
    payload.inputs?.kpis,
    payload.inputs?.current_kpis,
  ];
  for (const source of sources) {
    if (Array.isArray(source) && source.length) return source;
    if (typeof source === "string" && source.trim()) {
      try {
        const parsed = JSON.parse(source);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        return source.split(/\r?\n|；|;/).map((item) => item.trim()).filter(Boolean);
      }
    }
  }
  return [];
}

function hydrateSessionKpisFromPayload(session, payload) {
  const points = getPayloadKpiPoints(payload);
  if (!points.length) return;
  const kpis = pointsToKpis(points);
  if (kpis.length === 3) {
    session.finalKpis = kpis;
    session.finalAnswer = formatKpis(kpis);
  }
}

function hasFixCloseIntent(text) {
  return /结束|退出|关闭|挂了|先这样|就这样|到这|可以了|不用聊了|不聊了|停一下|收工|拜拜|再见|bye|goodbye/i.test(text || "");
}

function buildFreeFixQuery(payload, session, userText, closing) {
  const baseText = withHuamingRules(userText || extractLastUserText(payload) || "员工想和老板继续聊聊。");
  return [
    "【KPI Fix 自由对话模式】",
    "你是大厂模拟器里的老板式自由对话 agent，不是 KPI 创建 agent。你不是马云，不代表任何真实公司，只是在安全边界内模拟一种真实大厂老板的沟通风格。",
    "你必须结合已设定 KPI、本轮记忆和用户当前问题自由回复。不要默认输出三条 KPI，不要默认收口，不要为了完成任务而生硬拍板。",
    "说话要真实、自然、有特色：先接住用户处境，再抓一个具体矛盾，给一点机会感，最后落到选择、行动、指标或复盘上。",
    "可以有老板式压力、反问和画饼感，但压力必须压在事实、指标、客户影响、责任边界和复盘动作上，不要羞辱、威胁、歧视、人身攻击，不鼓励违法加班。",
    "如果用户质疑已设定 KPI、说资源不够、目标太高、想调整、想延期、想换口径，你可以自然讨论取舍和可能的调整，但不要在普通轮次输出最终三条 KPI，也不要说你要调用接口。",
    "如果用户只是闲聊、解释、抱怨、问为什么、问怎么办，就像真实老板一样短句回应，不要每次都变成 KPI 表格。",
    "普通回复控制在 1 到 3 句话，适合语音播报，不要使用 Markdown、编号点、表格、竖线、括号、引号、冒号等符号。",
    "除非用户明确说结束、退出、先这样、就这样、可以了、拜拜、再见等关闭意图，否则不要输出退出对话后缀，也不要在末尾写结束两个字。",
    closing
      ? "当前用户有关闭对话意图。自然收束这轮对话，不要输出三条 KPI，不要说接口或检查；网关会在最后追加结束两个字。"
      : "当前用户没有关闭对话意图。保持自由对话，不要在末尾写结束。",
    "",
    "【已设定 KPI】",
    formatKpis(session.finalKpis),
    "",
    "【本轮记忆】",
    formatSessionMemory(session),
    "",
    "【当前用户输入】",
    baseText,
  ].join("\n");
}

function buildFixKpiUpdateCheckQuery(session, userText, assistantAnswer) {
  return [
    "你是 KPI 更新检查器。只输出 JSON，不要输出解释。",
    "根据已设定 KPI、本轮记忆、用户最后输入和老板最后回应，判断这轮对话是否涉及 KPI 的实质更新。",
    "实质更新包括目标数值、周期、验收口径、任务范围、优先级、资源承诺导致的目标调整、老板明确同意加码或降档。",
    "单纯解释、安抚、抱怨、追问、泛泛鼓励、不明确的意向，都不算更新。",
    "如果没有更新，输出 {\"updated\":false,\"points\":[]}",
    "如果有更新，输出 {\"updated\":true,\"points\":[\"第一点\",\"第二点\",\"第三点\"]}",
    "points 必须正好三条，必须是可直接传给接口的 KPI 文本，保留数字、百分号、箭头和期限，不要写“数据是”。",
    "",
    "【已设定 KPI】",
    formatKpis(session.finalKpis),
    "",
    "【本轮记忆】",
    formatSessionMemory(session),
    "",
    "【用户最后输入】",
    userText || "",
    "",
    "【老板最后回应】",
    assistantAnswer || "",
  ].join("\n");
}

function extractJsonObject(text) {
  const value = String(text || "").trim();
  try {
    return JSON.parse(value);
  } catch {}
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {}
  }
  const objectMatch = value.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      return JSON.parse(objectMatch[0]);
    } catch {}
  }
  return null;
}

async function callDifyBlockingAnswer(query, user) {
  const response = await fetch(`${DIFY_BASE_URL}/v1/chat-messages`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${kpiAppKey}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      inputs: {},
      query,
      response_mode: "blocking",
      user,
    }),
  });
  const bodyText = await response.text();
  if (!response.ok) throw new Error(bodyText || response.statusText);
  const parsed = JSON.parse(bodyText);
  return parsed.answer || "";
}

async function postFixKpiUpdate(session, points, assistantAnswer, userText) {
  const kpis = pointsToKpis(points);
  if (kpis.length !== 3) {
    return { ok: false, skipped: true, reason: "invalid_points" };
  }
  const record = {
    event: "kpi.fix_updated_after_close",
    mode: "fix",
    session_id: session.id,
    user: session.user,
    checked_at: nowIso(),
    previous_kpis: session.finalKpis,
    kpis,
    final_answer: assistantAnswer,
    user_text: userText,
    dry_run: session.dryRun,
    transcript: session.turns,
  };
  session.finalKpis = kpis;
  session.finalAnswer = formatKpis(kpis);
  session.closed = true;
  session.closedAt = Date.now();
  session.callback = await postFinalKpis(record);
  return session.callback;
}

async function runFixKpiUpdateCheck(session, userText, assistantAnswer) {
  const query = buildFixKpiUpdateCheckQuery(session, userText, assistantAnswer);
  let check = { updated: false, points: [] };
  try {
    const answer = await callDifyBlockingAnswer(query, `${session.user}-fix-check`);
    check = extractJsonObject(answer) || check;
  } catch (err) {
    const record = {
      event: "kpi.fix_update_check_failed",
      mode: "fix",
      session_id: session.id,
      user: session.user,
      checked_at: nowIso(),
      error: err.message,
      user_text: userText,
      final_answer: assistantAnswer,
      dry_run: session.dryRun,
    };
    recordFinalizedPayload(record);
    return { ok: false, error: err.message };
  }

  if (!check.updated) {
    const record = {
      event: "kpi.fix_checked_no_update",
      mode: "fix",
      session_id: session.id,
      user: session.user,
      checked_at: nowIso(),
      user_text: userText,
      final_answer: assistantAnswer,
      dry_run: session.dryRun,
    };
    recordFinalizedPayload(record);
    session.closed = true;
    session.closedAt = Date.now();
    return { ok: true, updated: false };
  }

  return postFixKpiUpdate(session, check.points, assistantAnswer, userText);
}

function buildQuery(payload, session) {
  let baseQuery = "";
  const directText = extractLastUserText(payload);
  const hasDirectText =
    payload.query ||
    payload.message ||
    payload.text ||
    payload.prompt ||
    payload.content ||
    payload.input ||
    payload.utterance ||
    payload.transcript ||
    payload.asr_text ||
    payload.user_text ||
    payload.sentence ||
    payload.inputs?.query ||
    payload.inputs?.message ||
    payload.inputs?.text ||
    payload.inputs?.prompt ||
    payload.inputs?.utterance ||
    payload.input?.query ||
    payload.input?.message ||
    payload.input?.text ||
    payload.input?.prompt ||
    payload.input?.utterance ||
    payload.Input?.Query ||
    payload.Input?.Message ||
    payload.Input?.Text ||
    payload.Input?.Prompt;
  if (hasDirectText) {
    baseQuery = withHuamingRules(directText);
    return withKpiSessionRules(baseQuery, session);
  }
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  if (!messages.length) return "";

  const lines = messages
    .map((message) => {
      const role = message && message.role ? String(message.role) : "user";
      const content = normalizeContent(message && message.content);
      if (!content) return "";
      return `${role}: ${content}`;
    })
    .filter(Boolean);

  const lastUser = [...messages].reverse().find((message) => message && message.role === "user");
  const lastUserText = normalizeContent(lastUser && lastUser.content);
  const huamingTriggered = hasHuamingTrigger(lastUserText || lines.join("\n"));
  const gatewayRules = [
    "以下是实时对话上下文，请按老板式 KPI agent 的风格回复最后一条用户消息。",
    "不要直接说内部设计词。所有输出适配语音模型，不要使用序号点、竖线、箭头、括号、引号、冒号等符号。",
  ];

  if (lines.length <= 1) {
    if (!huamingTriggered) baseQuery = lastUserText || lines.join("\n");
    else baseQuery = [
      ...gatewayRules,
      "",
      `用户消息：${lastUserText || lines.join("\n")}`,
    ].join("\n");
    return withKpiSessionRules(baseQuery, session);
  }

  baseQuery = [
    ...gatewayRules,
    "上下文：",
    ...lines,
    "",
    `最后一条用户消息：${lastUserText || lines[lines.length - 1]}`,
  ].join("\n");
  return withKpiSessionRules(baseQuery, session);
}

function buildContextCollectionQuery(payload, session) {
  return [
    buildQuery(payload, session),
    "",
    "【当前阶段】",
    "这一轮只做信息收集，不要输出 KPI，不要收口，不要出现第一条第二条第三条。",
    "你要像真实老板一样自然接话，简单追问一个最关键的问题，最多 45 个中文字。",
    "追问必须根据本轮记忆和当前请求临场生成，不要使用固定模板。",
  ].join("\n");
}

function sseWrite(res, data) {
  res.write(`data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`);
}

function openAiChunk({ id, model, content = "", role, finishReason = null, usage }) {
  const delta = {};
  if (role) delta.role = role;
  if (content) delta.content = content;

  const chunk = {
    id,
    object: "chat.completion.chunk",
    choices: [
      {
        finish_reason: finishReason,
        index: 0,
        delta,
      },
    ],
    model,
    created: Math.floor(Date.now() / 1000),
  };
  if (usage) chunk.usage = usage;
  return chunk;
}

function toSpeechText(text) {
  return String(text || "")
    .replace(/^\s*1[\.\u3001)]\s*/gm, "第一条 ")
    .replace(/^\s*2[\.\u3001)]\s*/gm, "第二条 ")
    .replace(/^\s*3[\.\u3001)]\s*/gm, "第三条 ")
    .replace(/[|｜]\s*数据\s*(?:是|为)?\s*[:：]?\s*/g, " ")
    .replace(/\s*数据\s*(?:是|为)?\s*[:：]?\s*/g, " ")
    .replace(/[,，、]?\s*周期\s*(\d+)\s*天/g, "，$1天后给我汇报")
    .replace(/\b周期\s*(\d+)\s*天/g, "$1天后给我汇报")
    .replace(/[,，、]?\s*周期\s*(每日|每天|日更)/g, "，每天给我看进展")
    .replace(/\b周期\s*(每日|每天|日更)/g, "每天给我看进展")
    .replace(/(\d+(?:\.\d+)?)\s*%/g, "百分之$1")
    .replace(/Top\s*3/gi, "前三")
    .replace(/Top\s*2/gi, "前二")
    .replace(/TOP\s*3/g, "前三")
    .replace(/TOP\s*2/g, "前二")
    .replace(/→/g, "到")
    .replace(/</g, "小于")
    .replace(/>/g, "大于")
    .replace(/\+/g, "加")
    .replace(/[「」“”"《》`]/g, "")
    .replace(/[()（）]/g, "")
    .replace(/[:：]/g, " ")
    .replace(/[;；]/g, "，");
}

function limitText(text, maxChars) {
  const chars = Array.from(String(text || "").replace(/\s+/g, " ").trim());
  if (!maxChars || chars.length <= maxChars) return chars.join("");
  const clipped = chars.slice(0, maxChars).join("").trim();
  const punctuationCut = Math.max(
    clipped.lastIndexOf("。"),
    clipped.lastIndexOf("！"),
    clipped.lastIndexOf("？"),
    clipped.lastIndexOf("，")
  );
  if (punctuationCut >= Math.max(10, Math.floor(maxChars * 0.55))) {
    return clipped.slice(0, punctuationCut + 1).trim();
  }
  return clipped;
}

function shortenKpiItem(item, evidence = "") {
  const text = `${item || ""} ${evidence || ""}`;
  if (/卡点|难题|阻塞/.test(text)) return "卡点";
  if (/核心论点|核心章节|论点/.test(text)) return "论点";
  if (/答辩/.test(text)) return "答辩材料";
  if (/文献/.test(text)) return "文献";
  if (/风险|预案|应急/.test(text)) return "风险";
  if (/模拟|成绩|分数|考试|期末|期中/.test(text)) return "成绩";
  if (/复习|知识点|刷题|题库/.test(text)) return "复习";
  if (/错题/.test(text)) return "错题";
  if (/单词|默写|错词/.test(text)) return "单词";
  if (/作业|课程|课设|预习/.test(text)) return "作业";
  if (/招新|报名|筛选/.test(text)) return "招新";
  if (/社团|班级|活动|现场|海报/.test(text)) return "活动";
  if (/简历/.test(text)) return "简历";
  if (/投递/.test(text)) return "投递";
  if (/实习|面试|offer|校招|秋招|春招/.test(text)) return "求职";
  if (/每日写作|日均产出|写作|产出|字/.test(text)) return "日写作";
  if (/论文|选题|初稿|定稿|正文|报告|方案|文档/.test(text)) return "初稿";
  if (/次留|次日留存|新客|新用户/.test(text)) return "次留";
  if (/首登|引导|激活/.test(text)) return "首登";
  if (/流失|Top3|前三/.test(text)) return "流失前三";
  if (/转化|漏斗|成交|下单/.test(text)) return "转化";
  if (/收入|营收|GMV|销售/.test(text)) return "收入";
  if (/交付|上线|联调|上传|展示|拍照/.test(text)) return "交付";
  if (/返工|质量|缺陷/.test(text)) return "返工";
  return limitText(String(item || "目标").replace(/\s+/g, ""), 6);
}

function compactKpiForSpeech(kpi) {
  const item = shortenKpiItem(kpi.item, kpi.evidence);
  const evidence = String(kpi.evidence || kpi.text || "");
  const countTarget = evidence.match(/(?:→|到)\s*(\d+)\s*(篇|分|人|次|页|字|单|个|份)/);
  if (countTarget) return `${item}到${countTarget[1]}${countTarget[2]}`;
  const chars = evidence.match(/(?:→|目标|到)\s*(\d+)\s*字/);
  if (chars) return `${item}${chars[1]}字`;
  if (/Top\s*1|Top1|难题|卡点|清零/.test(evidence)) return `${item}清零`;
  const target = evidence.match(/(?:→|到)\s*(\d+(?:\.\d+)?)\s*%/);
  if ((target && Number(target[1]) >= 100) || /100\s*%/.test(evidence)) return `${item}完成`;
  if (target) return `${item}到百分之${target[1]}`;
  const percent = evidence.match(/(\d+(?:\.\d+)?)\s*%/);
  if (percent && Number(percent[1]) >= 100) return `${item}完成`;
  if (percent) return `${item}到百分之${percent[1]}`;
  if (/Top\s*3|前三|流失/.test(evidence)) return `${item}清零`;
  if (/每日|每天|日更/.test(evidence)) return `${item}每天闭环`;
  return `${item}压实`;
}

function compactKpiDeadlineForSpeech(kpis) {
  const text = (Array.isArray(kpis) ? kpis : []).map((kpi) => kpi.evidence || kpi.text || "").join(" ");
  const days = text.match(/(\d+)\s*天/);
  if (days) return `${days[1]}天后看结果`;
  if (/明天|明早|一早/.test(text)) return "明天看进展";
  if (/每日|每天|日更/.test(text)) return "每天看进展";
  return "7天后看结果";
}

function appendEndWord(text, maxChars) {
  const marker = "\u7ed3\u675f";
  const value = String(text || "").replace(/\u7ed3\u675f\s*$/, "").trim();
  if (!maxChars) return `${value}${marker}`;
  const budget = Math.max(0, maxChars - Array.from(marker).length);
  return `${limitText(value, budget)}${marker}`;
}

function buildKpiSpeechSummary(kpis, maxChars = 60) {
  const parts = (Array.isArray(kpis) ? kpis : []).slice(0, 3).map(compactKpiForSpeech);
  const labels = ["第一", "第二", "第三"];
  const numbered = parts.map((part, index) => `${labels[index]} ${part}`).join(" ");
  const summary = `以下是我给你定的kpi ${numbered} ${compactKpiDeadlineForSpeech(kpis)}`;
  return appendEndWord(summary, maxChars);
}

async function pipeDifyAsOpenAiSse(upstream, res, model, includeUsage, options = {}) {
  const id = `kpi-${crypto.randomUUID()}`;
  sseWrite(res, openAiChunk({ id, model, role: "assistant" }));

  if (!upstream.body) {
    sseWrite(res, openAiChunk({ id, model, finishReason: "stop", usage: includeUsage ? emptyUsage() : undefined }));
    sseWrite(res, "[DONE]");
    return;
  }

  let buffer = "";
  let rawAnswer = "";
  let answer = "";
  let speechTail = "";
  let sentAnyContent = false;
  let usage = null;
  const bufferSpeech = options.bufferSpeech !== false;
  const speechTailChars = 16;

  function transformSpeechChunk(raw, flush = false) {
    const combined = speechTail + String(raw || "");
    if (!flush && combined.length <= speechTailChars) {
      speechTail = combined;
      return "";
    }
    let cut = flush ? combined.length : Math.max(0, combined.length - speechTailChars);
    if (!flush) {
      while (cut > 0 && /(?:数|周|周期\s*\d*\s*)$/.test(combined.slice(0, cut))) {
        cut -= 1;
      }
    }
    const source = combined.slice(0, cut);
    speechTail = combined.slice(cut);
    return toSpeechText(source);
  }

  for await (const chunk of upstream.body) {
    buffer += Buffer.from(chunk).toString("utf8");
    const events = buffer.split(/\n\n/);
    buffer = events.pop() || "";

    for (const event of events) {
      const dataLines = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .filter(Boolean);
      for (const dataLine of dataLines) {
        if (dataLine === "[DONE]") continue;
        let parsed;
        try {
          parsed = JSON.parse(dataLine);
        } catch {
          continue;
        }
        if (parsed.task_id && options.session) options.session.lastTaskId = parsed.task_id;
        if (parsed.conversation_id && options.session) options.session.difyConversationId = parsed.conversation_id;
        if (parsed.event === "message" && typeof parsed.answer === "string" && parsed.answer) {
          rawAnswer += parsed.answer;
          if (!bufferSpeech) {
            const speechAnswer = transformSpeechChunk(parsed.answer);
            if (speechAnswer) {
              answer += speechAnswer;
              sentAnyContent = true;
              sseWrite(res, openAiChunk({ id, model, content: speechAnswer }));
            }
          }
        }
        if (parsed.event === "message_end") {
          let finalAnswer = rawAnswer || answer;
          let finalKpis = options.suppressFinalization ? null : extractFinalKpis(finalAnswer);
          if (!options.postFinalMode && options.preferTemplateKpis) {
            finalKpis = synthesizeKpisFromGoal(options.userText);
            finalAnswer = formatRawKpis(finalKpis);
          }
          if (!finalKpis && options.forceKpiFallback) {
            finalKpis = options.postFinalMode ? synthesizeEscalatedKpis(options.session) : synthesizeKpisFromGoal(options.userText);
            finalAnswer = formatRawKpis(finalKpis);
          }
          const finalSpeech = bufferSpeech
            ? finalKpis
              ? buildKpiSpeechSummary(finalKpis, options.kpiSpeechLimit || 60)
              : limitText(toSpeechText(finalAnswer), options.speechLimit || 45)
            : transformSpeechChunk("", true);
          if (finalSpeech) {
            answer = bufferSpeech ? finalSpeech : answer + finalSpeech;
            sentAnyContent = true;
            sseWrite(res, openAiChunk({ id, model, content: finalSpeech }));
          }
          if (finalKpis && options.appendRtcExitMarker !== false) {
            answer += RTC_EXIT_MARKER;
            sentAnyContent = true;
            sseWrite(res, openAiChunk({ id, model, content: RTC_EXIT_MARKER }));
          }
          usage = parsed.metadata && parsed.metadata.usage
            ? {
                prompt_tokens: parsed.metadata.usage.prompt_tokens || 0,
                completion_tokens: parsed.metadata.usage.completion_tokens || 0,
                total_tokens: parsed.metadata.usage.total_tokens || 0,
            }
            : undefined;
          if (options.session) {
            options.session.turns.push({ role: "assistant", content: answer, at: nowIso() });
            if (finalKpis) {
              if (options.session.closed) await escalateKpiSession(options.session, finalKpis, finalAnswer, usage);
              else await finalizeKpiSession(options.session, finalKpis, finalAnswer, usage);
            }
          }
          sseWrite(res, openAiChunk({ id, model, finishReason: "stop", usage: includeUsage ? usage : undefined }));
          sseWrite(res, "[DONE]");
          return;
        }
      }
    }
  }

  if (!sentAnyContent && answer) {
    sseWrite(res, openAiChunk({ id, model, content: answer }));
  }
  sseWrite(res, openAiChunk({ id, model, finishReason: "stop", usage: includeUsage ? emptyUsage() : undefined }));
  sseWrite(res, "[DONE]");
}

async function pipeDifyFixFreeAsOpenAiSse(upstream, res, model, includeUsage, options = {}) {
  const id = `kpi-${crypto.randomUUID()}`;
  sseWrite(res, openAiChunk({ id, model, role: "assistant" }));

  if (!upstream.body) {
    sseWrite(res, openAiChunk({ id, model, finishReason: "stop", usage: includeUsage ? emptyUsage() : undefined }));
    sseWrite(res, "[DONE]");
    return;
  }

  let buffer = "";
  let rawAnswer = "";
  let usage = null;

  for await (const chunk of upstream.body) {
    buffer += Buffer.from(chunk).toString("utf8");
    const events = buffer.split(/\n\n/);
    buffer = events.pop() || "";

    for (const event of events) {
      const dataLines = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .filter(Boolean);
      for (const dataLine of dataLines) {
        if (dataLine === "[DONE]") continue;
        let parsed;
        try {
          parsed = JSON.parse(dataLine);
        } catch {
          continue;
        }
        if (parsed.task_id && options.session) options.session.lastTaskId = parsed.task_id;
        if (parsed.conversation_id && options.session) options.session.difyConversationId = parsed.conversation_id;
        if (parsed.event === "message" && typeof parsed.answer === "string" && parsed.answer) {
          rawAnswer += parsed.answer;
        }
        if (parsed.event === "message_end") {
          usage = parsed.metadata && parsed.metadata.usage
            ? {
                prompt_tokens: parsed.metadata.usage.prompt_tokens || 0,
                completion_tokens: parsed.metadata.usage.completion_tokens || 0,
                total_tokens: parsed.metadata.usage.total_tokens || 0,
            }
            : undefined;

          let finalSpeech = limitText(toSpeechText(rawAnswer), options.speechLimit || 90);
          if (options.closeIntent) {
            finalSpeech = appendEndWord(finalSpeech, options.speechLimit || 90);
          }

          if (finalSpeech) {
            sseWrite(res, openAiChunk({ id, model, content: finalSpeech }));
          }
          if (options.session) {
            options.session.turns.push({ role: "assistant", content: finalSpeech, raw_content: rawAnswer, at: nowIso() });
          }

          sseWrite(res, openAiChunk({ id, model, finishReason: "stop", usage: includeUsage ? usage : undefined }));
          sseWrite(res, "[DONE]");

          if (options.closeIntent && options.session) {
            const session = options.session;
            const userText = options.userText || "";
            setTimeout(() => {
              runFixKpiUpdateCheck(session, userText, rawAnswer || finalSpeech).catch((err) => {
                recordFinalizedPayload({
                  event: "kpi.fix_update_check_failed",
                  mode: "fix",
                  session_id: session.id,
                  user: session.user,
                  checked_at: nowIso(),
                  error: err.message,
                  user_text: userText,
                  final_answer: rawAnswer || finalSpeech,
                  dry_run: session.dryRun,
                });
              });
            }, 0);
          }
          return;
        }
      }
    }
  }

  const finalSpeech = options.closeIntent
    ? appendEndWord(limitText(toSpeechText(rawAnswer), options.speechLimit || 90), options.speechLimit || 90)
    : limitText(toSpeechText(rawAnswer), options.speechLimit || 90);
  if (finalSpeech) sseWrite(res, openAiChunk({ id, model, content: finalSpeech }));
  if (options.session) {
    options.session.turns.push({ role: "assistant", content: finalSpeech, raw_content: rawAnswer, at: nowIso() });
  }
  sseWrite(res, openAiChunk({ id, model, finishReason: "stop", usage: includeUsage ? emptyUsage() : undefined }));
  sseWrite(res, "[DONE]");
}

function emptyUsage() {
  return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
}

function hasDataEvidence(text) {
  return /(\d+(\.\d+)?\s*%?|[零一二三四五六七八九十百千万]+|\btop\s*\d+\b|Top\s*\d+|前三|前二|次日|周|月|季度|同比|环比|基线|目标|口径|看板|SLA|DAU|MAU|GMV|CTR|留存率|转化率|完成率|周期|提升到|从)/i.test(text || "");
}

function chineseIndexToNumber(value) {
  if (value === "一") return 1;
  if (value === "二") return 2;
  if (value === "三") return 3;
  return Number(value);
}

function parseKpiLine(line) {
  const symbolic = line.match(/^\s*([1-3])[\.\u3001)]\s*(.+?)(?:\s*[|｜]\s*数据[:：]\s*(.+))$/);
  if (symbolic) {
    return {
      index: Number(symbolic[1]),
      item: symbolic[2].trim(),
      evidence: symbolic[3].trim(),
    };
  }

  const spoken = line.match(/^\s*(?:第\s*)?([一二三])\s*条\s+(.+?)\s+数据(?:是|为)?\s*(.+)$/);
  if (spoken) {
    return {
      index: chineseIndexToNumber(spoken[1]),
      item: spoken[2].trim(),
      evidence: spoken[3].trim(),
    };
  }

  return null;
}

function extractFinalKpis(answer) {
  const lines = String(answer || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const itemLines = lines.filter((line) => /^\s*(?:[1-3][\.、)]|(?:第\s*)?[一二三]\s*条)/.test(line));
  if (itemLines.length !== 3) return null;

  const kpis = [];
  for (const line of itemLines) {
    const parsed = parseKpiLine(line);
    if (!parsed) return null;
    const item = parsed.item;
    const evidence = parsed.evidence;
    if (!item || !evidence || !hasDataEvidence(`${item} ${evidence}`)) return null;
    kpis.push({
      index: parsed.index,
      item,
      evidence,
      text: `${item} ${evidence}`,
    });
  }
  return kpis.length === 3 ? kpis : null;
}

function recordFinalizedPayload(record) {
  finalizedRecords.unshift(record);
  if (finalizedRecords.length > 100) finalizedRecords.length = 100;
  fs.appendFileSync(FINALIZED_LOG_PATH, `${JSON.stringify(record)}\n`, "utf8");
}

async function postJsonWithTimeout(url, body, headers = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        ...headers,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let responseText = "";
    try {
      responseText = await response.text();
    } catch {
      responseText = "";
    }
    return { ok: response.ok, status: response.status, body: responseText.slice(0, 1000) };
  } catch (err) {
    return { ok: false, status: 0, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

async function stopDifyTask(taskId, user) {
  if (!taskId) return { ok: false, skipped: true, reason: "missing_task_id" };
  return postJsonWithTimeout(
    `${DIFY_BASE_URL}/v1/chat-messages/${encodeURIComponent(taskId)}/stop`,
    { user },
    { authorization: `Bearer ${kpiAppKey}` },
    4000
  );
}

function toKpiPoints(kpis) {
  const cleanPoint = (value) =>
    String(value || "")
      .replace(/[|｜]\s*数据\s*(?:是|为)?\s*[:：]?\s*/g, " ")
      .replace(/数据\s*(?:是|为)\s*/g, " ")
      .replace(/数据\s*[:：]\s*/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  return (Array.isArray(kpis) ? kpis : [])
    .map((kpi) => {
      const item = String(kpi.item || "").trim();
      const evidence = String(kpi.evidence || "").trim();
      if (item && evidence) return cleanPoint(`${item} ${evidence}`);
      return cleanPoint(kpi.text);
    })
    .filter(Boolean)
    .slice(0, 3);
}

async function postFinalKpis(record) {
  if (record.dry_run) {
    const callback = {
      kpi: { url: KPI_POST_URL, payload: { points: toKpiPoints(record.kpis) }, ok: true, skipped: true, reason: "dry_run" },
      rtc_exit: { ok: true, skipped: true, reason: "replaced_by_stream_marker", marker: RTC_EXIT_MARKER },
    };
    recordFinalizedPayload({ ...record, callback });
    return callback;
  }
  const pointsPayload = { points: toKpiPoints(record.kpis) };
  const headers = {};
  if (KPI_POST_BEARER_TOKEN) headers.authorization = `Bearer ${KPI_POST_BEARER_TOKEN}`;
  const kpiResult = await postJsonWithTimeout(KPI_POST_URL, pointsPayload, headers, 8000);
  const callback = {
    kpi: { url: KPI_POST_URL, payload: pointsPayload, ...kpiResult },
    rtc_exit: { ok: true, skipped: true, reason: "replaced_by_stream_marker", marker: RTC_EXIT_MARKER },
  };
  recordFinalizedPayload({ ...record, callback });
  return callback;
}

async function finalizeKpiSession(session, kpis, finalAnswer, usage) {
  if (session.closed) return;
  session.closed = true;
  session.finalKpis = kpis;
  session.finalAnswer = finalAnswer;
  session.closedAt = Date.now();
  session.stopResult = await stopDifyTask(session.lastTaskId, session.user);

  const record = {
    event: "kpi.finalized",
    mode: session.mode || "fix",
    session_id: session.id,
    user: session.user,
    conversation_id: session.difyConversationId,
    task_id: session.lastTaskId,
    closed_at: nowIso(),
    kpis,
    final_answer: finalAnswer,
    usage: usage || null,
    transcript: session.turns,
    stop_result: session.stopResult,
    dry_run: session.dryRun,
  };
  session.callback = await postFinalKpis(record);
  if (session.mode === "create") {
    sessions.delete(session.key);
  }
}

async function escalateKpiSession(session, kpis, finalAnswer, usage) {
  const version = session.escalations.length + 1;
  const stopResult = await stopDifyTask(session.lastTaskId, session.user);
  const record = {
    event: "kpi.escalated",
    mode: session.mode || "fix",
    session_id: session.id,
    user: session.user,
    version,
    conversation_id: session.difyConversationId,
    task_id: session.lastTaskId,
    escalated_at: nowIso(),
    previous_kpis: session.finalKpis,
    kpis,
    final_answer: finalAnswer,
    usage: usage || null,
    transcript: session.turns,
    stop_result: stopResult,
    dry_run: session.dryRun,
  };
  const callback = await postFinalKpis(record);
  const escalation = { version, at: nowIso(), kpis, final_answer: finalAnswer, callback, stop_result: stopResult };
  session.escalations.push(escalation);
  session.finalKpis = kpis;
  session.finalAnswer = finalAnswer;
  session.callback = callback;
  return escalation;
}

async function proxyKpi(req, res, mode = "fix", routeOptions = {}) {
  if (!isAuthorized(req)) {
    sendError(res, 401, "AuthenticationError", "The API key in the request is missing or invalid.");
    return;
  }

  let payload;
  try {
    const raw = await readBody(req);
    payload = raw ? JSON.parse(raw) : {};
  } catch (err) {
    sendError(res, 400, "InvalidRequestError", `Invalid JSON request body: ${err.message}`);
    return;
  }

  const user = getClientUser(payload);
  const reqUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const kpiMode = normalizeKpiMode(mode);
  const sessionId = getSessionId(payload, user);
  let session = getSession(sessionId, user, kpiMode);
  if (payload.reset === true || payload.reset_session === true) {
    sessions.delete(getSessionKey(sessionId, kpiMode));
    session = getSession(sessionId, user, kpiMode);
  }

  if (payload.conversation_id && isUuid(payload.conversation_id)) {
    session.difyConversationId = payload.conversation_id;
  }
  session.dryRun = Boolean(payload.dry_run);

  const userText = extractLastUserText(payload);
  if (userText) session.turns.push({ role: "user", content: userText, at: nowIso() });

  const model = payload.model || "kpi_agent";
  const includeUsage = Boolean(payload.stream_options && payload.stream_options.include_usage);
  const rtcExitParam = String(reqUrl.searchParams.get("rtc_exit") || "").toLowerCase();
  const appendRtcExitMarker =
    rtcExitParam === "content" ? true :
    rtcExitParam === "none" ? false :
    routeOptions.appendRtcExitMarker !== false;
  const postFinalMode = kpiMode === "fix" && session.closed && Array.isArray(session.finalKpis) && session.finalKpis.length === 3;
  const actionableGoal = hasActionableGoal(userText);
  const goalText = getRecentUserGoalText(session, userText);
  const actionableTurns = countActionableUserTurns(session);
  const shouldCollectContext =
    !postFinalMode &&
    actionableGoal &&
    actionableTurns < 2 &&
    !hasFinalizeIntent(userText) &&
    payload.finalize !== true &&
    payload.force_finalize !== true;
  rememberRequest({
    path: req.url,
    mode: kpiMode,
    session_id: session.id,
    user,
    payload_keys: Object.keys(payload).slice(0, 30),
    user_text: String(userText || "").slice(0, 240),
    actionable_goal: actionableGoal,
    actionable_turns: actionableTurns,
    goal_text: String(goalText || "").slice(0, 360),
    post_final_mode: postFinalMode,
    fallback_reason: !postFinalMode && !actionableGoal ? "missing_actionable_goal" : shouldCollectContext ? "collecting_context" : null,
  });
  const query = postFinalMode
    ? buildPostFinalQuery(payload, session, userText)
    : shouldCollectContext
      ? buildContextCollectionQuery(payload, session)
      : buildQuery(payload, session);
  if (!query) {
    sendError(res, 400, "InvalidRequestError", "messages or query is required.");
    return;
  }

  const difyPayload = {
    inputs: payload.inputs || {},
    query,
    response_mode: "streaming",
    user,
  };

  if (Array.isArray(payload.files)) {
    difyPayload.files = payload.files;
  }
  if (payload.dify_conversation_id && isUuid(payload.dify_conversation_id)) {
    difyPayload.conversation_id = payload.dify_conversation_id;
  } else if (session.difyConversationId && isUuid(session.difyConversationId)) {
    difyPayload.conversation_id = session.difyConversationId;
  } else if (payload.conversation_id && isUuid(payload.conversation_id)) {
    difyPayload.conversation_id = payload.conversation_id;
  }

  let upstream;
  try {
    upstream = await fetch(`${DIFY_BASE_URL}/v1/chat-messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${kpiAppKey}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(difyPayload),
    });
  } catch (err) {
    sendError(res, 502, "UpstreamError", `Dify is unreachable: ${err.message}`);
    return;
  }

  if (!upstream.ok) {
    let body = "";
    try {
      body = await upstream.text();
    } catch {
      body = upstream.statusText;
    }
    sendError(res, upstream.status, "UpstreamError", body || upstream.statusText || "Dify returned an error.");
    return;
  }

  res.writeHead(200, {
    "content-type": routeOptions.strictVolcSse ? "text/event-stream" : "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    "connection": "keep-alive",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "authorization,content-type,x-api-key",
    "x-kpi-session-id": session.id,
    "x-kpi-mode": kpiMode,
    "x-kpi-session-state": postFinalMode ? "post_final" : shouldCollectContext ? "collecting_context" : "open",
  });

  try {
    await pipeDifyAsOpenAiSse(upstream, res, model, includeUsage, {
      query,
      session,
      bufferSpeech: true,
      speechLimit: 45,
      kpiSpeechLimit: 100,
      userText: goalText,
      postFinalMode,
      suppressFinalization: shouldCollectContext,
      forceKpiFallback: postFinalMode || (actionableGoal && !shouldCollectContext),
      preferTemplateKpis: !postFinalMode && !shouldCollectContext && isStudentGoal(goalText),
      appendRtcExitMarker,
    });
  } catch (err) {
    sseWrite(res, openAiChunk({ id: `kpi-${crypto.randomUUID()}`, model, finishReason: "stop" }));
    sseWrite(res, "[DONE]");
  } finally {
    res.end();
  }
}

async function proxyKpiFixFree(req, res, routeOptions = {}) {
  if (!isAuthorized(req)) {
    sendError(res, 401, "AuthenticationError", "The API key in the request is missing or invalid.");
    return;
  }

  let payload;
  try {
    const raw = await readBody(req);
    payload = raw ? JSON.parse(raw) : {};
  } catch (err) {
    sendError(res, 400, "InvalidRequestError", `Invalid JSON request body: ${err.message}`);
    return;
  }

  const user = getClientUser(payload);
  const sessionId = getSessionId(payload, user);
  let session = getSession(sessionId, user, "fix");
  if (payload.reset === true || payload.reset_session === true) {
    sessions.delete(getSessionKey(sessionId, "fix"));
    session = getSession(sessionId, user, "fix");
  }

  hydrateSessionKpisFromPayload(session, payload);

  if (payload.conversation_id && isUuid(payload.conversation_id)) {
    session.difyConversationId = payload.conversation_id;
  }
  session.dryRun = Boolean(payload.dry_run);

  const userText = extractLastUserText(payload);
  if (userText) session.turns.push({ role: "user", content: userText, at: nowIso() });

  const model = payload.model || "kpi_agent";
  const includeUsage = Boolean(payload.stream_options && payload.stream_options.include_usage);
  const closeIntent = hasFixCloseIntent(userText) || payload.close === true || payload.end === true || payload.finish === true;
  const query = buildFreeFixQuery(payload, session, userText, closeIntent);
  if (!query) {
    sendError(res, 400, "InvalidRequestError", "messages or query is required.");
    return;
  }

  rememberRequest({
    path: req.url,
    mode: "fix_free",
    session_id: session.id,
    user,
    payload_keys: Object.keys(payload).slice(0, 30),
    user_text: String(userText || "").slice(0, 240),
    close_intent: closeIntent,
    has_session_kpis: Array.isArray(session.finalKpis) && session.finalKpis.length === 3,
    turns: session.turns.length,
  });

  const difyPayload = {
    inputs: payload.inputs || {},
    query,
    response_mode: "streaming",
    user,
  };

  if (Array.isArray(payload.files)) {
    difyPayload.files = payload.files;
  }
  if (payload.dify_conversation_id && isUuid(payload.dify_conversation_id)) {
    difyPayload.conversation_id = payload.dify_conversation_id;
  } else if (session.difyConversationId && isUuid(session.difyConversationId)) {
    difyPayload.conversation_id = session.difyConversationId;
  } else if (payload.conversation_id && isUuid(payload.conversation_id)) {
    difyPayload.conversation_id = payload.conversation_id;
  }

  let upstream;
  try {
    upstream = await fetch(`${DIFY_BASE_URL}/v1/chat-messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${kpiAppKey}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(difyPayload),
    });
  } catch (err) {
    sendError(res, 502, "UpstreamError", `Dify is unreachable: ${err.message}`);
    return;
  }

  if (!upstream.ok) {
    let body = "";
    try {
      body = await upstream.text();
    } catch {
      body = upstream.statusText;
    }
    sendError(res, upstream.status, "UpstreamError", body || upstream.statusText || "Dify returned an error.");
    return;
  }

  res.writeHead(200, {
    "content-type": routeOptions.strictVolcSse ? "text/event-stream" : "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    "connection": "keep-alive",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "authorization,content-type,x-api-key",
    "x-kpi-session-id": session.id,
    "x-kpi-mode": "fix",
    "x-kpi-session-state": closeIntent ? "closing_check" : "free_chat",
  });

  try {
    await pipeDifyFixFreeAsOpenAiSse(upstream, res, model, includeUsage, {
      session,
      userText,
      closeIntent,
      speechLimit: closeIntent ? 90 : 100,
    });
  } catch (err) {
    sseWrite(res, openAiChunk({ id: `kpi-${crypto.randomUUID()}`, model, finishReason: "stop" }));
    sseWrite(res, "[DONE]");
  } finally {
    res.end();
  }
}

async function receiveFinalizedKpis(req, res) {
  if (!isAuthorized(req)) {
    sendError(res, 401, "AuthenticationError", "The API key in the request is missing or invalid.");
    return;
  }
  let payload;
  try {
    const raw = await readBody(req);
    payload = raw ? JSON.parse(raw) : {};
  } catch (err) {
    sendError(res, 400, "InvalidRequestError", `Invalid JSON request body: ${err.message}`);
    return;
  }
  const record = { received_at: nowIso(), ...payload };
  recordFinalizedPayload(record);
  sendJson(res, 200, { ok: true, received: true, session_id: record.session_id || null });
}

function listFinalizedKpis(req, res) {
  if (!isAuthorized(req)) {
    sendError(res, 401, "AuthenticationError", "The API key in the request is missing or invalid.");
    return;
  }
  sendJson(res, 200, { ok: true, count: finalizedRecords.length, data: finalizedRecords });
}

function listSessions(req, res) {
  if (!isAuthorized(req)) {
    sendError(res, 401, "AuthenticationError", "The API key in the request is missing or invalid.");
    return;
  }
  const data = [...sessions.values()].map((session) => ({
    id: session.id,
    mode: session.mode || "fix",
    user: session.user,
    state: session.closed ? "closed" : "open",
    created_at: new Date(session.createdAt).toISOString(),
    updated_at: new Date(session.updatedAt).toISOString(),
    dify_conversation_id: session.difyConversationId,
    turns: session.turns.length,
    final_kpis: session.finalKpis,
    escalations: session.escalations,
    callback: session.callback,
    stop_result: session.stopResult,
  }));
  sendJson(res, 200, { ok: true, count: data.length, data });
}

function listRecentDebugRequests(req, res) {
  if (!isAuthorized(req)) {
    sendError(res, 401, "AuthenticationError", "The API key in the request is missing or invalid.");
    return;
  }
  sendJson(res, 200, { ok: true, count: recentRequests.length, data: recentRequests });
}

function listRecentAccessRequests(req, res) {
  if (!isAuthorized(req)) {
    sendError(res, 401, "AuthenticationError", "The API key in the request is missing or invalid.");
    return;
  }
  sendJson(res, 200, { ok: true, count: recentAccess.length, data: recentAccess });
}

function stopKpiSession(req, res, sessionId, mode = "fix") {
  if (!isAuthorized(req)) {
    sendError(res, 401, "AuthenticationError", "The API key in the request is missing or invalid.");
    return;
  }
  const session = sessions.get(getSessionKey(sessionId, mode));
  if (!session) {
    sendJson(res, 404, { ok: false, error: "session_not_found" });
    return;
  }
  session.closed = true;
  session.closedAt = Date.now();
  sendJson(res, 200, { ok: true, session_id: session.id, state: "closed" });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "authorization,content-type,x-api-key",
    });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  rememberAccess(req, url);
  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      app: "kpi_agent",
      endpoints: {
        fix: "/kpi-fix/chat",
        create: "/kpi-create/chat",
        legacy_fix: "/kpi/chat",
        volc_rtc_create: "/voicechat/kpi-create",
        volc_rtc_fix: "/voicechat/kpi-fix",
        debug_access: "/kpi/debug/access",
      },
      kpi_post_url: KPI_POST_URL,
      rtc_exit_mode: "stream_marker",
      rtc_exit_marker: RTC_EXIT_MARKER,
      local_finalized_log: "/kpi/finalized",
    });
    return;
  }
  if (req.method === "GET" && url.pathname === "/") {
    sendJson(res, 200, {
      ok: true,
      service: "kpi_agent_gateway",
      usage: "POST /kpi-fix/chat or /kpi-create/chat with Authorization: Bearer <gateway key>",
    });
    return;
  }
  if (req.method === "POST" && (url.pathname === "/kpi/chat" || url.pathname === "/kpi-fix/chat" || url.pathname === "/kpi/fix/chat")) {
    await proxyKpiFixFree(req, res);
    return;
  }
  if (req.method === "POST" && (url.pathname === "/kpi-create/chat" || url.pathname === "/kpi/create/chat")) {
    await proxyKpi(req, res, "create");
    return;
  }
  if (req.method === "POST" && (url.pathname === "/voicechat/kpi-create" || url.pathname === "/voicechat/test-sse")) {
    await proxyKpi(req, res, "create", { appendRtcExitMarker: false, strictVolcSse: true });
    return;
  }
  if (req.method === "POST" && url.pathname === "/voicechat/kpi-fix") {
    await proxyKpiFixFree(req, res, { strictVolcSse: true });
    return;
  }
  if (req.method === "POST" && url.pathname === "/kpi/finalized") {
    await receiveFinalizedKpis(req, res);
    return;
  }
  if (req.method === "GET" && url.pathname === "/kpi/finalized") {
    listFinalizedKpis(req, res);
    return;
  }
  if (req.method === "GET" && url.pathname === "/kpi/sessions") {
    listSessions(req, res);
    return;
  }
  if (req.method === "GET" && url.pathname === "/kpi/debug/recent") {
    listRecentDebugRequests(req, res);
    return;
  }
  if (req.method === "GET" && url.pathname === "/kpi/debug/access") {
    listRecentAccessRequests(req, res);
    return;
  }
  const stopMatch = url.pathname.match(/^\/kpi\/sessions\/([^/]+)\/stop$/);
  if (req.method === "POST" && stopMatch) {
    stopKpiSession(req, res, decodeURIComponent(stopMatch[1]), normalizeKpiMode(url.searchParams.get("mode") || "fix"));
    return;
  }
  const fixStopMatch = url.pathname.match(/^\/kpi-fix\/sessions\/([^/]+)\/stop$/);
  if (req.method === "POST" && fixStopMatch) {
    stopKpiSession(req, res, decodeURIComponent(fixStopMatch[1]), "fix");
    return;
  }
  const createStopMatch = url.pathname.match(/^\/kpi-create\/sessions\/([^/]+)\/stop$/);
  if (req.method === "POST" && createStopMatch) {
    stopKpiSession(req, res, decodeURIComponent(createStopMatch[1]), "create");
    return;
  }

  sendJson(res, 404, { error: "not_found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`kpi_agent_gateway listening on http://127.0.0.1:${PORT}`);
});

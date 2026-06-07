import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  BadgeCheck,
  BarChart3,
  BellRing,
  BriefcaseBusiness,
  Camera,
  ClipboardList,
  Coffee,
  Crown,
  Eye,
  Home,
  ImageOff,
  MessageSquareText,
  Monitor,
  RotateCcw,
  Save,
  Settings,
  ShieldAlert,
  Smartphone,
  Target,
  UserRound,
  Users,
  X,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import './App.css'

type TabId = 'home' | 'group' | 'okr'
type SyncState = 'idle' | 'syncing' | 'success' | 'fallback' | 'error'
type KpiAction = 'create' | 'update'

type SceneId =
  | 'computer'
  | 'phone'
  | 'fish'
  | 'daze'
  | 'sleep'
  | 'writing'
  | 'defense'
  | 'meal'
  | 'chat'
  | 'alone'

type BossId = 'dong' | 'lei' | 'ma' | 'dongming'

type Scene = {
  id: SceneId
  label: string
  shortLabel: string
  category: string
  reason: string
  status: string
  monitor: string
  quote: string
  fishBase: number
  puaBase: number
  closureBase: number
  icon: LucideIcon
}

type StatusVideo = {
  src: string
  width: number
  height: number
}

type Boss = {
  id: BossId
  company: string
  name: string
  badge: string
  title: string
  habit: string
  tokenCost: number
  voiceSrc: string
  portraitSrc: string
  unlocked: boolean
}

type CaptureItem = {
  id: string
  filename: string
  localFilename?: string
  url: string
  category?: string
  size?: number
  modifiedAt?: number
  modifiedAtIso?: string
}

type ImageListResponse = {
  ok: boolean
  category: string
  count: number
  items: CaptureItem[]
}

type RokidStatusResponse = {
  ok: boolean
  category: string
  state?: string
  scene?: string
  analysisStatus?: string
  updatedAtIso?: string
  confidence?: number
  reason?: string
  evidence?: string[]
  imageUrl?: string
  filename?: string
  sceneLabels?: string[]
  localImageUrl?: string
  imageSavedAtIso?: string
  imageDownloadError?: string
  capture?: CaptureItem | null
}

type RemoteKpiResponse = {
  ok: boolean
  kpi?: string
  points?: string[]
  updatedAtIso?: string
}

type MetricSet = {
  fish: number
  pua: number
  closure: number
}

type ReportRecord = {
  id: string
  sceneId: SceneId
  bossId: BossId
  time: string
  captureUrl: string
  captureName: string
  captureCategory?: string
  reason: string
  summary: string
  quote: string
  metrics: MetricSet
}

type GroupChatItem = {
  id: string
  type: 'criticism' | 'reply' | 'message'
  avatarUrl: string
  nickname: string
  text: string
  imageUrl: string
  category: string
  filename: string
  previousScene: string
  scene: string
  createdAtIso: string
}

type GroupChatFeed = {
  source: 'api' | 'mock'
  groupId: string
  maxCount: number
  count: number
  items: GroupChatItem[]
  screenshot: {
    idleText: string
    capturedText: string
    shoutText: string
  }
}

type GroupChatInput = {
  boss: Boss
  profile: Profile
  report: ReportRecord
  scene: Scene
}

type PosterMetric = {
  label: string
  value: string
  suffix: string
}

type RankAssessment = {
  code: string
  title: string
  summary: string
  score: number
}

type ClassicQuote = {
  bossId: BossId
  company: string
  name: string
  quote: string
}

type ReportPosterResult = {
  ok: boolean
  url: string
  dataUrl: string
  filename: string
  savedAtIso: string
  sourceMessageId: string
}

type RemoteImageUploadResponse = {
  ok?: boolean
  item?: {
    filename?: string
    url?: string
    modifiedAtIso?: string
  }
}

type OkrItem = {
  id: string
  objective: string
  progress: number
  due: string
  keyResults: string[]
  pressurePoint: string
  sourceUpdatedAtIso?: string
}

type Profile = {
  userName: string
  targetRole: string
  categoryMode: 'scene' | 'manual'
  category: string
  cadence: number
}

type PrintAvatarState = {
  status: 'idle' | 'processing' | 'ready' | 'declined' | 'error'
  url: string
  error?: string
  updatedAtIso?: string
}

type DemoStep = {
  sceneId: SceneId
  label: string
  duration: string
  order: string
}

const API_PROXY = '/api'
const LOCAL_STATUS_API = '/local-api/status'
const LOCAL_REPORT_POSTER_API = '/local-api/report-poster'
const LOCAL_CARTOON_AVATAR_API = '/local-api/cartoon-avatar'
const REMOTE_KPI_API = `${API_PROXY}/kpi`
const GROUP_CHAT_API = `${API_PROXY}/group-chat/messages`
const REMOTE_REPORT_POSTER_UPLOAD_API = `${API_PROXY}/images/upload?category=generated-posters`
const TTS_VOICE_API = `${API_PROXY}/tts/voice`
const GROUP_CHAT_ID = 'work'
const KPI_DUE_LABEL = '4天11时后截止'
const REMOTE_KPI_DRAFT_PROGRESS = 12
const DEFAULT_PRESIDENT_TOKEN_COUNT = 18736
const BOSS_CALL_VIDEO_SRC = '/effects/boss-call.mp4'
const ROKID_STATUS_CATEGORY = 'rokid'
const STORAGE_KEYS = {
  bossId: 'pua-boss-id',
  latestPoster: 'pua-latest-report-poster',
  okrs: 'pua-okrs',
  printAvatar: 'pua-print-avatar',
  profile: 'pua-profile',
  reports: 'pua-reports',
  secondaryBossId: 'pua-secondary-boss-id',
} as const

let hasSyncedInitialTtsVoice = false

const SCENES: Scene[] = [
  {
    id: 'computer',
    label: '认真学习中',
    shortLabel: '看电脑',
    category: 'demo',
    reason: '电脑前停留超过一轮采样，正在判断是否真有产出',
    status: '代码/作业窗口活跃',
    monitor: '观察中',
    quote: '打开电脑不是交付，关闭摸鱼才是闭环。',
    fishBase: 18,
    puaBase: 64,
    closureBase: 72,
    icon: Monitor,
  },
  {
    id: 'phone',
    label: '看手机',
    shortLabel: '看手机',
    category: 'phone',
    reason: '低头角度稳定，疑似在和短视频进行深度共创',
    status: '已触发提醒',
    monitor: '准备通报',
    quote: '你手里拿的是手机，老板眼里看的是风险。',
    fishBase: 82,
    puaBase: 89,
    closureBase: 35,
    icon: Smartphone,
  },
  {
    id: 'fish',
    label: '摸鱼中',
    shortLabel: '摸鱼',
    category: 'fish',
    reason: '屏幕/视线高频游移，疑似在非任务页面里假装找资料',
    status: '已触发提醒',
    monitor: '正在抓包',
    quote: '摸鱼可以有灵感，但不能没有产出凭证。',
    fishBase: 88,
    puaBase: 86,
    closureBase: 33,
    icon: Coffee,
  },
  {
    id: 'daze',
    label: '发呆复盘中',
    shortLabel: '发呆',
    category: 'daze',
    reason: '视野长时间锁定天花板，疑似在和空气对齐战略',
    status: '正在生成通报',
    monitor: '已抓包',
    quote: '天花板没有 KPI，但你有。',
    fishBase: 72,
    puaBase: 81,
    closureBase: 42,
    icon: Eye,
  },
  {
    id: 'sleep',
    label: '低头蓄能',
    shortLabel: '睡觉',
    category: 'sleep',
    reason: '画面稳定下沉，桌面占比异常升高',
    status: '等待用户回应',
    monitor: '严重预警',
    quote: '短暂休息可以理解，长期离线需要复盘。',
    fishBase: 91,
    puaBase: 94,
    closureBase: 28,
    icon: ShieldAlert,
  },
  {
    id: 'writing',
    label: '写东西',
    shortLabel: '写东西',
    category: 'writing',
    reason: '纸面/文档输入中，产出可信度正在上升',
    status: '观察中',
    monitor: '低风险',
    quote: '写了不等于完成，完成才算对齐。',
    fishBase: 24,
    puaBase: 58,
    closureBase: 78,
    icon: ClipboardList,
  },
  {
    id: 'defense',
    label: '会议室答辩中',
    shortLabel: '答辩',
    category: 'defense',
    reason: '检测到汇报姿态，自动切入转正答辩压力面',
    status: '压力面进行中',
    monitor: '老板追问',
    quote: '请用一句话解释你的不可替代性。',
    fishBase: 33,
    puaBase: 96,
    closureBase: 64,
    icon: BriefcaseBusiness,
  },
  {
    id: 'meal',
    label: '吃饭回血',
    shortLabel: '吃饭',
    category: 'food',
    reason: '餐盘/杯具出现，系统判断正在进行非工时能量补给',
    status: '观察中',
    monitor: '轻度提醒',
    quote: '饭可以吃，目标不能凉。',
    fishBase: 38,
    puaBase: 52,
    closureBase: 55,
    icon: Zap,
  },
  {
    id: 'chat',
    label: '和朋友聊天',
    shortLabel: '聊天',
    category: 'chat',
    reason: '多人声源/侧脸频繁出现，疑似进入横向拉通',
    status: '已触发提醒',
    monitor: '准备通报',
    quote: '沟通是协作，闲聊是未立项需求。',
    fishBase: 68,
    puaBase: 76,
    closureBase: 48,
    icon: Users,
  },
  {
    id: 'alone',
    label: '一个人默认',
    shortLabel: '独处',
    category: 'alone',
    reason: '画面缺少协作对象，系统默认进入自驱力抽检模式',
    status: '观察中',
    monitor: '独处摸排',
    quote: '没人盯着的时候，才最能看出闭环自觉。',
    fishBase: 44,
    puaBase: 69,
    closureBase: 57,
    icon: UserRound,
  },
]

const STATUS_VIDEOS = {
  computer: { src: '/status-videos/computer.mp4', width: 960, height: 960 },
  phone: { src: '/status-videos/phone.mp4', width: 1112, height: 834 },
  fish: { src: '/status-videos/fish.mp4', width: 960, height: 960 },
  meal: { src: '/status-videos/meal.mp4', width: 960, height: 960 },
  chat: { src: '/status-videos/chat.mp4', width: 960, height: 960 },
  writing: { src: '/status-videos/writing.mp4', width: 960, height: 960 },
  alone: { src: '/status-videos/alone.mp4', width: 1112, height: 834 },
  bossTalk: { src: '/status-videos/boss-talk.mp4', width: 720, height: 720 },
  bossMeeting: { src: '/status-videos/boss-meeting.mp4', width: 720, height: 720 },
} satisfies Record<string, StatusVideo>

const ALI_VALUES = ['客户第一', '团队合作', '拥抱变化', '诚信', '激情', '敬业']

const BOSSES: Boss[] = [
  {
    id: 'ma',
    company: '阿里爸妈',
    name: '牛马云',
    badge: '牛',
    title: '价值观巡场官',
    habit: '先问价值观，再问你有没有结果',
    tokenCost: 4,
    voiceSrc: '/voices/mayun.mp3',
    portraitSrc: '/boss-assets/mayun.png',
    unlocked: true,
  },
  {
    id: 'dong',
    company: '京西',
    name: '咚咚强',
    badge: '东',
    title: '总裁办巡场',
    habit: '所有松弛感都要有业务解释',
    tokenCost: 3,
    voiceSrc: '/voices/dong.mp3',
    portraitSrc: '/boss-assets/liuqiangdong.png',
    unlocked: true,
  },
  {
    id: 'lei',
    company: '大米',
    name: '雷布斯',
    badge: '雷',
    title: '性价比追问官',
    habit: '先讲梦想，再问交付成本',
    tokenCost: 2,
    voiceSrc: '/voices/lei.mp3',
    portraitSrc: '/boss-assets/leijun.png',
    unlocked: true,
  },
  {
    id: 'dongming',
    company: '格外',
    name: '董小姐',
    badge: '董',
    title: '纪律型老板',
    habit: '先抓纪律，再抓产能',
    tokenCost: 5,
    voiceSrc: '/voices/dongming.mp3',
    portraitSrc: '/boss-assets/dongmingzhu.png',
    unlocked: true,
  },
]

const TTS_VOICE_BY_BOSS: Record<BossId, string> = {
  ma: '马云',
  dong: '刘强东',
  lei: '雷军',
  dongming: '董明珠',
}

const CLASSIC_QUOTES: ClassicQuote[] = [
  { bossId: 'ma', company: '阿里爸妈', name: '牛马云', quote: '996 是福报' },
  { bossId: 'ma', company: '阿里爸妈', name: '牛马云', quote: '梦想还是要有的' },
  { bossId: 'dong', company: '京西', name: '咚咚强', quote: '兄弟不能掉队' },
  { bossId: 'dong', company: '京西', name: '咚咚强', quote: '长期主义，别摸鱼' },
  { bossId: 'lei', company: '大米', name: '雷布斯', quote: 'Are U OK' },
  { bossId: 'lei', company: '大米', name: '雷布斯', quote: 'India Mi Fans' },
  { bossId: 'dongming', company: '格外', name: '董小姐', quote: '格力没有对手' },
  { bossId: 'dongming', company: '格外', name: '董小姐', quote: '格力手机世界第一' },
]

const DEFAULT_PROFILE: Profile = {
  userName: '你',
  targetRole: '把当前行为转化为一项可验收结果',
  categoryMode: 'scene',
  category: 'demo',
  cadence: 10,
}

const INITIAL_OKRS: OkrItem[] = [
  {
    id: 'okr-1',
    objective: '把当前行为转化为一项可验收结果',
    progress: 62,
    due: KPI_DUE_LABEL,
    keyResults: ['同步一张眼镜证据图', '写清楚本轮状态解释', '在部门大群完成一次可追溯汇报'],
    pressurePoint: '这件事如果今晚复盘，能不能证明你不是在自我感动？',
  },
  {
    id: 'okr-2',
    objective: '准备下一轮老板拷打材料',
    progress: 38,
    due: KPI_DUE_LABEL,
    keyResults: ['明确本轮 KPI 验收口径', '沉淀 5 条贡献证据', '模拟老板拷打至少 1 轮'],
    pressurePoint: '你的不可替代性是能力，还是只是大家脾气好？',
  },
]

const tabs: Array<{ id: TabId; label: string; icon: LucideIcon }> = [
  { id: 'home', label: '首页', icon: Home },
  { id: 'group', label: '报告总结', icon: BarChart3 },
  { id: 'okr', label: 'KPI', icon: Target },
]

const DEMO_SCRIPT: DemoStep[] = [
  { sceneId: 'daze', label: '抬头看天花板', duration: '15s', order: '01' },
  { sceneId: 'sleep', label: '低头睡觉', duration: '15s', order: '02' },
  { sceneId: 'phone', label: '看手机', duration: '15s', order: '03' },
  { sceneId: 'computer', label: '用电脑网购', duration: '15s', order: '04' },
]

const sleep = (duration: number) =>
  new Promise((resolve) => {
    window.setTimeout(resolve, duration)
  })

const addCacheBuster = (url: string, value: number | string) => {
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}v=${encodeURIComponent(String(value))}`
}

const preloadImage = async (url: string, attempts = 3): Promise<void> => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await new Promise<void>((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve()
        image.onerror = () => reject(new Error('image load failed'))
        image.src = url
      })
      return
    } catch (error) {
      if (attempt === attempts - 1) throw error
      await sleep(180)
    }
  }
}

const clampMetric = (value: number) => Math.max(0, Math.min(99, value))

const getRankAssessment = (fishValue: number, pressureValue: number): RankAssessment => {
  const score = clampMetric(Math.round(pressureValue * 0.68 + (100 - fishValue) * 0.32))

  if (score >= 86) {
    return {
      code: 'P8',
      title: '集团核心牛马',
      summary: '抗压稳定、摸鱼风险低，具备跨部门背锅潜质。',
      score,
    }
  }

  if (score >= 72) {
    return {
      code: 'P7',
      title: '高级抗压牛马',
      summary: '压力承接能力在线，偶发摸鱼但还能解释成业务观察。',
      score,
    }
  }

  if (score >= 58) {
    return {
      code: 'P6',
      title: '稳定交付牛马',
      summary: '可以继续观察，建议补充证据链并提高抗压闭环。',
      score,
    }
  }

  if (score >= 42) {
    return {
      code: 'P5',
      title: '摸鱼待观察',
      summary: '摸鱼信号偏强，抗压表现不足，建议进入周会重点关怀。',
      score,
    }
  }

  return {
    code: 'P4',
    title: '约谈预警牛马',
    summary: '摸鱼高发且抗压不足，建议立即安排老板一对一辅导。',
    score,
  }
}

const formatClock = (value: string) =>
  new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(value))

const formatChatTime = (value: string) => {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : formatClock(value)
}

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const getRecordValue = (source: Record<string, unknown>, key: string) => {
  const value = source[key]
  return isPlainRecord(value) ? value : {}
}

const pickString = (
  source: Record<string, unknown>,
  keys: string[],
  fallback = '',
) => {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.trim()) return value
  }

  return fallback
}

const getScene = (id: SceneId) => SCENES.find((scene) => scene.id === id) ?? SCENES[0]
const getBoss = (id: BossId) => BOSSES.find((boss) => boss.id === id) ?? BOSSES[0]

const getSceneIdFromStatus = (status: RokidStatusResponse): SceneId => {
  const statusText = [status.state, status.scene].filter(Boolean).join(' ')

  if (statusText.includes('看电脑')) return 'computer'
  if (statusText.includes('看手机')) return 'phone'
  if (statusText.includes('摸鱼')) return 'fish'
  if (statusText.includes('吃喝') || statusText.includes('吃饭')) return 'meal'
  if (statusText.includes('和朋友聊天')) return 'chat'
  if (statusText.includes('写东西')) return 'writing'
  if (statusText.includes('老板交流') || statusText.includes('老板约谈')) return 'defense'
  if (statusText.includes('一个人的默认') || statusText.includes('一个人默认')) return 'alone'

  return 'alone'
}

const getStatusLabel = (status: RokidStatusResponse | null, scene: Scene) =>
  status?.state || status?.scene || scene.shortLabel

const getStatusVideo = (statusLabel: string, scene: Scene): StatusVideo => {
  if (statusLabel.includes('老板约谈')) return STATUS_VIDEOS.bossMeeting
  if (statusLabel.includes('老板交流')) return STATUS_VIDEOS.bossTalk
  if (statusLabel.includes('看电脑')) return STATUS_VIDEOS.computer
  if (statusLabel.includes('看手机')) return STATUS_VIDEOS.phone
  if (statusLabel.includes('摸鱼')) return STATUS_VIDEOS.fish
  if (statusLabel.includes('吃喝') || statusLabel.includes('吃饭')) return STATUS_VIDEOS.meal
  if (statusLabel.includes('和朋友聊天') || statusLabel.includes('聊天')) return STATUS_VIDEOS.chat
  if (statusLabel.includes('写东西')) return STATUS_VIDEOS.writing
  if (statusLabel.includes('一个人的默认') || statusLabel.includes('一个人默认') || statusLabel.includes('独处')) {
    return STATUS_VIDEOS.alone
  }

  if (scene.id === 'phone') return STATUS_VIDEOS.phone
  if (scene.id === 'fish') return STATUS_VIDEOS.fish
  if (scene.id === 'meal') return STATUS_VIDEOS.meal
  if (scene.id === 'chat') return STATUS_VIDEOS.chat
  if (scene.id === 'writing') return STATUS_VIDEOS.writing
  if (scene.id === 'alone') return STATUS_VIDEOS.alone
  if (scene.id === 'defense') return STATUS_VIDEOS.bossTalk

  return STATUS_VIDEOS.computer
}

const shouldShowGlassesAlert = (statusLabel: string, scene: Scene) => {
  const alertText = `${statusLabel} ${scene.shortLabel}`
  return (
    alertText.includes('看手机') ||
    alertText.includes('摸鱼') ||
    alertText.includes('和朋友聊天') ||
    scene.id === 'phone' ||
    scene.id === 'fish' ||
    scene.id === 'chat'
  )
}

const isBossMeetingStatus = (statusLabel: string) => {
  const normalizedLabel = statusLabel.toLowerCase()
  return (
    statusLabel.includes('老板约谈') ||
    normalizedLabel.includes('boss-meeting') ||
    normalizedLabel.includes('bossmeeting')
  )
}

const rewriteCaptureUrl = (url: string) => {
  if (!url) return ''

  try {
    const parsed = new URL(url)
    if (parsed.hostname === 'www.yhaox.top' && parsed.port === '18091') {
      return `${API_PROXY}${parsed.pathname}${parsed.search}`
    }
  } catch {
    return url
  }

  return url
}

const fetchLatestCapture = async (category: string) => {
  const response = await fetch(
    `${API_PROXY}/images?category=${encodeURIComponent(category)}`,
    { cache: 'no-store' },
  )

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  const result = (await response.json()) as ImageListResponse
  const latest = result.items
    .slice()
    .sort((a, b) => (b.modifiedAt ?? 0) - (a.modifiedAt ?? 0))[0]

  return {
    category: result.category,
    count: result.count,
    latest: latest
      ? {
          ...latest,
          category: result.category,
          url: rewriteCaptureUrl(latest.url),
        }
      : null,
  }
}

const fetchRokidStatus = async (category = ROKID_STATUS_CATEGORY) => {
  const response = await fetch(
    `${LOCAL_STATUS_API}?category=${encodeURIComponent(category)}`,
    { cache: 'no-store' },
  )

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  const status = (await response.json()) as RokidStatusResponse
  return {
    ...status,
    category: status.category ?? category,
    capture: status.capture
      ? {
          ...status.capture,
          url: status.capture.url || status.localImageUrl || '',
          category: status.capture.category ?? status.category ?? category,
    }
      : null,
  }
}

const normalizeKpiPoint = (value: string) =>
  value
    .replace(/^\s*(?:\d+[\s.、)]*)/, '')
    .replace(/\s+/g, ' ')
    .trim()

const getRemoteKpiPoints = (payload: RemoteKpiResponse) => {
  const rawPoints = payload.points?.length
    ? payload.points
    : payload.kpi
      ? payload.kpi.split(/\n+/)
      : []

  return rawPoints.map(normalizeKpiPoint).filter(Boolean).slice(0, 3)
}

const getRemoteKpiObjective = (points: string[]) => {
  if (!points.length) return '等待老板下发 KPI'
  const firstPoint = points[0]
  return firstPoint.split(/\s+/).slice(0, 2).join(' ') || firstPoint
}

const toRemoteKpiItem = (payload: RemoteKpiResponse, previous: OkrItem): OkrItem | null => {
  const points = getRemoteKpiPoints(payload)
  if (!payload.ok || points.length === 0) return null

  const updatedAtIso = payload.updatedAtIso ?? `${Date.now()}`
  return {
    ...previous,
    id: `remote-kpi-${updatedAtIso}`,
    objective: getRemoteKpiObjective(points),
    progress: REMOTE_KPI_DRAFT_PROGRESS,
    due: KPI_DUE_LABEL,
    keyResults: points,
    pressurePoint: '三项 KPI 均未完成，当前进入待验收状态。先补证据，再谈进度。',
    sourceUpdatedAtIso: updatedAtIso,
  }
}

const fetchRemoteKpi = async (signal?: AbortSignal) => {
  const response = await fetch(REMOTE_KPI_API, { cache: 'no-store', signal })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  return (await response.json()) as RemoteKpiResponse
}

const updateTtsVoice = async (bossId: BossId) => {
  const response = await fetch(TTS_VOICE_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ voice: TTS_VOICE_BY_BOSS[bossId] }),
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
}

const createReport = (
  scene: Scene,
  boss: Boss,
  profile: Profile,
  capture: CaptureItem | null,
  sequence: number,
): ReportRecord => {
  const time = new Date().toISOString()
  const fish = clampMetric(scene.fishBase + ((sequence + 2) % 5) * 3)
  const pua = clampMetric(scene.puaBase + (sequence % 4) * 2)
  const closure = clampMetric(scene.closureBase - (sequence % 3) * 4)

  return {
    id: `report-${Date.now()}-${sequence}`,
    sceneId: scene.id,
    bossId: boss.id,
    time,
    captureUrl: capture?.url ?? '',
    captureName: capture?.filename ?? `${scene.category}-pixel-evidence`,
    captureCategory: capture?.category ?? scene.category,
    reason: scene.reason,
    quote: scene.quote,
    summary: `${boss.name}认定${profile.userName}当前处于「${scene.shortLabel}」状态：${scene.reason}。建议立刻补一段进度说明，并把下一步交付拆成可验证动作。`,
    metrics: { fish, pua, closure },
  }
}

const createFallbackGroupChatFeed = ({
  boss,
  profile,
  report,
  scene,
}: GroupChatInput): GroupChatFeed => ({
  source: 'mock',
  groupId: 'work',
  maxCount: 10,
  count: 6,
  items: [
    {
      id: `${report.id}-criticism`,
      type: 'criticism',
      avatarUrl: boss.portraitSrc,
      nickname: boss.name,
      text: `@${profile.userName} ${report.summary}`,
      imageUrl: report.captureUrl,
      category: report.captureCategory ?? scene.category,
      filename: report.captureName,
      previousScene: '看电脑',
      scene: scene.shortLabel,
      createdAtIso: report.time,
    },
    {
      id: `${report.id}-reply-hr`,
      type: 'reply',
      avatarUrl: '',
      nickname: 'HR-婷婷',
      text: '已记录，后续纳入组织适配度观察。',
      imageUrl: '',
      category: report.captureCategory ?? scene.category,
      filename: '',
      previousScene: scene.shortLabel,
      scene: scene.shortLabel,
      createdAtIso: report.time,
    },
    {
      id: `${report.id}-reply-leader`,
      type: 'reply',
      avatarUrl: '',
      nickname: '部门Leader',
      text: '这个截图我先收下，周会同步看一下。',
      imageUrl: '',
      category: report.captureCategory ?? scene.category,
      filename: '',
      previousScene: scene.shortLabel,
      scene: scene.shortLabel,
      createdAtIso: report.time,
    },
    {
      id: `${report.id}-reply-tech`,
      type: 'reply',
      avatarUrl: '',
      nickname: '技术-老王',
      text: '建议严查一下，看看是不是开了非工作窗口。',
      imageUrl: '',
      category: report.captureCategory ?? scene.category,
      filename: '',
      previousScene: scene.shortLabel,
      scene: scene.shortLabel,
      createdAtIso: report.time,
    },
    {
      id: `${report.id}-reply-ops`,
      type: 'reply',
      avatarUrl: '',
      nickname: '运营-小美',
      text: '收到，今晚日报给他留一个位置。',
      imageUrl: '',
      category: report.captureCategory ?? scene.category,
      filename: '',
      previousScene: scene.shortLabel,
      scene: scene.shortLabel,
      createdAtIso: report.time,
    },
    {
      id: `${report.id}-reply-president-office`,
      type: 'reply',
      avatarUrl: '',
      nickname: '总裁办-小周',
      text: '已同步老板，等待本人补充闭环说明。',
      imageUrl: '',
      category: report.captureCategory ?? scene.category,
      filename: '',
      previousScene: scene.shortLabel,
      scene: scene.shortLabel,
      createdAtIso: report.time,
    },
  ],
  screenshot: {
    idleText: '截图',
    capturedText: `${profile.userName}已截图`,
    shoutText: '有人截图了！',
  },
})

const createEmptyGroupChatFeed = (profile: Profile): GroupChatFeed => ({
  source: 'mock',
  groupId: 'work',
  maxCount: 0,
  count: 0,
  items: [],
  screenshot: {
    idleText: '截图',
    capturedText: `${profile.userName}已截图`,
    shoutText: '有人截图了！',
  },
})

const normalizeGroupChatItemType = (type: string): GroupChatItem['type'] => {
  if (type === 'mock') return 'criticism'
  if (type === 'criticism' || type === 'reply') return type
  return 'message'
}

const normalizeGroupChatItems = (
  value: unknown,
  fallbackItems: GroupChatItem[],
) => {
  if (!Array.isArray(value)) return fallbackItems

  const items = value
    .map((item, index) => {
      if (!isPlainRecord(item)) return null

      const text = pickString(item, ['text', 'content', 'message'])
      if (!text) return null

      return {
        id: pickString(item, ['id'], `group-message-${index}`),
        type: normalizeGroupChatItemType(pickString(item, ['type'])),
        avatarUrl: rewriteCaptureUrl(pickString(item, ['avatarUrl'])),
        nickname: pickString(item, ['nickname', 'name', 'speaker', 'sender'], '同事'),
        text,
        imageUrl: rewriteCaptureUrl(pickString(item, ['imageUrl'])),
        category: pickString(item, ['category']),
        filename: pickString(item, ['filename']),
        previousScene: pickString(item, ['previousScene']),
        scene: pickString(item, ['scene']),
        createdAtIso: pickString(item, ['createdAtIso', 'createdAt', 'timestamp'], new Date().toISOString()),
      }
    })
    .filter((item): item is GroupChatItem => Boolean(item))

  return items.length ? items : fallbackItems
}

const normalizeGroupChatFeed = (
  payload: unknown,
  input: GroupChatInput,
): GroupChatFeed => {
  const fallback = createFallbackGroupChatFeed(input)
  const responseRoot = isPlainRecord(payload) ? payload : {}
  const root = isPlainRecord(responseRoot.data) ? responseRoot.data : responseRoot
  const screenshot = getRecordValue(root, 'screenshot')
  const source = pickString(root, ['source']) === 'local-mock' ? 'mock' : 'api'
  const items = normalizeGroupChatItems(root.items, fallback.items)

  return {
    source,
    groupId: pickString(root, ['groupId'], fallback.groupId),
    maxCount: typeof root.maxCount === 'number' ? root.maxCount : fallback.maxCount,
    count: typeof root.count === 'number' ? root.count : items.length,
    items,
    screenshot: {
      idleText: pickString(screenshot, ['idleText', 'idle'], fallback.screenshot.idleText),
      capturedText: pickString(
        screenshot,
        ['capturedText', 'captured'],
        fallback.screenshot.capturedText,
      ),
      shoutText: pickString(screenshot, ['shoutText', 'shout'], fallback.screenshot.shoutText),
    },
  }
}

const fetchGroupChatFeed = async (input: GroupChatInput, signal?: AbortSignal) => {
  const response = await fetch(
    `${GROUP_CHAT_API}?groupId=${encodeURIComponent(GROUP_CHAT_ID)}`,
    { cache: 'no-store', signal },
  )

  if (!response.ok) throw new Error(`HTTP ${response.status}`)

  return normalizeGroupChatFeed(await response.json(), input)
}

const loadCanvasImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    if (!src) {
      reject(new Error('missing image url'))
      return
    }

    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`image load failed: ${src}`))
    image.src = src
  })

const drawContainImage = (
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
) => {
  const ratio = Math.min(width / image.naturalWidth, height / image.naturalHeight)
  const drawWidth = image.naturalWidth * ratio
  const drawHeight = image.naturalHeight * ratio
  context.drawImage(
    image,
    x + (width - drawWidth) / 2,
    y + (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  )
}

const loadCanvasVideoFrame = (src: string) =>
  new Promise<HTMLVideoElement>((resolve, reject) => {
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.onloadeddata = () => resolve(video)
    video.onerror = () => reject(new Error(`video load failed: ${src}`))
    video.src = src
    video.load()
  })

const drawContainVideo = (
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  x: number,
  y: number,
  width: number,
  height: number,
) => {
  const sourceWidth = video.videoWidth || width
  const sourceHeight = video.videoHeight || height
  const ratio = Math.min(width / sourceWidth, height / sourceHeight)
  const drawWidth = sourceWidth * ratio
  const drawHeight = sourceHeight * ratio
  context.drawImage(
    video,
    x + (width - drawWidth) / 2,
    y + (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  )
}

const drawWrappedText = (
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines = 3,
) => {
  const characters = Array.from(text)
  let line = ''
  let currentY = y
  let lineCount = 0

  for (let index = 0; index < characters.length; index += 1) {
    const nextLine = `${line}${characters[index]}`
    if (context.measureText(nextLine).width <= maxWidth || !line) {
      line = nextLine
      continue
    }

    lineCount += 1
    if (lineCount >= maxLines) {
      let clipped = `${line}...`
      while (context.measureText(clipped).width > maxWidth && clipped.length > 4) {
        clipped = `${clipped.slice(0, -4)}...`
      }
      context.fillText(clipped, x, currentY)
      return currentY + lineHeight
    }

    context.fillText(line, x, currentY)
    currentY += lineHeight
    line = characters[index]
  }

  if (line && lineCount < maxLines) {
    context.fillText(line, x, currentY)
    currentY += lineHeight
  }

  return currentY
}

const drawReceiptLine = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
) => {
  context.save()
  context.strokeStyle = '#2b241e'
  context.lineWidth = 2
  context.setLineDash([9, 7])
  context.beginPath()
  context.moveTo(x, y)
  context.lineTo(x + width, y)
  context.stroke()
  context.restore()
}

const drawReceiptBox = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  fill = '#fffaf0',
) => {
  context.fillStyle = fill
  context.fillRect(x, y, width, height)
  context.strokeStyle = '#2b241e'
  context.lineWidth = 3
  context.strokeRect(x, y, width, height)
}

const drawThermalImage = (
  context: CanvasRenderingContext2D,
  draw: () => void,
) => {
  context.save()
  context.filter = 'grayscale(1) contrast(1.12) brightness(1.2)'
  draw()
  context.restore()
}

const pickRandomClassicQuotes = () => {
  const pool = CLASSIC_QUOTES.slice()
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    ;[pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]]
  }
  return pool.slice(0, Math.random() < 0.58 ? 1 : 2)
}

const estimateReceiptLines = (text: string, charsPerLine: number, maxLines: number) => {
  const lineCount = Math.ceil(Array.from(text || ' ').length / charsPerLine)
  return Math.max(1, Math.min(maxLines, lineCount))
}

const createDepartmentPosterImage = async ({
  boss,
  evidenceItem,
  groupFeed,
  metrics,
  printAvatar,
  profile,
  rankAssessment,
  scene,
}: {
  boss: Boss
  evidenceItem: GroupChatItem
  groupFeed: GroupChatFeed
  metrics: PosterMetric[]
  printAvatar: PrintAvatarState
  profile: Profile
  rankAssessment: RankAssessment
  scene: Scene
}) => {
  const width = 1000
  const posterSceneLabel = evidenceItem.scene || scene.shortLabel
  const statusVideo = getStatusVideo(posterSceneLabel, scene)
  const screenshotTime = new Date()
  const screenshotIso = screenshotTime.toISOString()
  const classicQuotes = pickRandomClassicQuotes()
  const transcriptItems: GroupChatItem[] = [
    ...groupFeed.items.slice(-8),
    {
      id: `${evidenceItem.id}-poster-captured`,
      type: 'message',
      avatarUrl: '',
      nickname: profile.userName,
      text: groupFeed.screenshot.capturedText,
      imageUrl: '',
      category: evidenceItem.category,
      filename: '',
      previousScene: posterSceneLabel,
      scene: posterSceneLabel,
      createdAtIso: screenshotIso,
    },
    {
      id: `${evidenceItem.id}-poster-shout`,
      type: 'criticism',
      avatarUrl: boss.portraitSrc,
      nickname: boss.name,
      text: groupFeed.screenshot.shoutText,
      imageUrl: '',
      category: evidenceItem.category,
      filename: '',
      previousScene: posterSceneLabel,
      scene: posterSceneLabel,
      createdAtIso: screenshotIso,
    },
  ]
  const transcriptRowHeights = transcriptItems.map((item) => {
    const textLines = estimateReceiptLines(item.text, item.type === 'criticism' ? 34 : 38, 4)
    return Math.max(78, 44 + textLines * 24 + (item.imageUrl ? 30 : 0))
  })
  const headerY = 94
  const quoteY = 374
  const quoteHeight = classicQuotes.length > 1 ? 268 : 236
  const evidenceY = quoteY + quoteHeight + 40
  const evidenceHeight = 454
  const transcriptY = evidenceY + evidenceHeight + 40
  const transcriptHeight = 82 + transcriptRowHeights.reduce((sum, itemHeight) => sum + itemHeight, 0) + 30
  const metricY = transcriptY + transcriptHeight + 40
  const metricHeight = 266
  const rankY = metricY + metricHeight + 40
  const rankHeight = 206
  const footerY = rankY + rankHeight + 54
  const height = Math.max(2200, footerY + 54)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d')
  if (!context) throw new Error('canvas unavailable')

  const printAvatarUrl = printAvatar.status === 'ready' ? printAvatar.url : ''
  const [evidenceImage, bossImage, statusVideoFrame, printAvatarImage] = await Promise.all([
    loadCanvasImage(evidenceItem.imageUrl),
    loadCanvasImage(boss.portraitSrc),
    loadCanvasVideoFrame(statusVideo.src).catch(() => null),
    printAvatarUrl ? loadCanvasImage(printAvatarUrl).catch(() => null) : Promise.resolve(null),
  ])

  const ink = '#1d1814'
  const mutedInk = '#5f544a'
  const faintInk = 'rgba(29, 24, 20, 0.12)'
  const paper = '#fffdf6'
  const sectionPaper = '#fff8ea'
  const receiptNo = evidenceItem.id.replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase() || '00000000'
  const savedAtText = screenshotTime.toLocaleString('zh-CN', { hour12: false })

  context.imageSmoothingEnabled = true
  context.fillStyle = '#fff7e6'
  context.fillRect(0, 0, width, height)
  context.fillStyle = 'rgba(29, 24, 20, 0.035)'
  for (let x = 0; x < width; x += 22) context.fillRect(x, 0, 1, height)
  for (let y = 0; y < height; y += 22) context.fillRect(0, y, width, 1)

  drawReceiptBox(context, 36, 34, 928, height - 68, paper)
  context.fillStyle = 'rgba(255, 255, 255, 0.42)'
  context.fillRect(48, 48, 904, height - 96)
  drawReceiptLine(context, 72, 72, 856)
  drawReceiptLine(context, 72, height - 66, 856)

  drawReceiptBox(context, 72, headerY, 856, 188, '#fffaf0')
  context.fillStyle = ink
  context.font = '900 43px sans-serif'
  context.fillText('牛马预备役——试炼结果', 98, 154)
  context.fillStyle = mutedInk
  context.font = '800 23px sans-serif'
  context.fillText(`${boss.company} · ${boss.name} 巡场记录`, 100, 196)
  context.font = '800 20px sans-serif'
  context.fillText(`${profile.userName} · ${posterSceneLabel} · ${formatChatTime(evidenceItem.createdAtIso)}`, 100, 232)
  context.strokeStyle = ink
  context.lineWidth = 2
  context.strokeRect(100, 244, 510, 28)
  context.fillStyle = ink
  context.font = '900 19px sans-serif'
  context.fillText(`职级 ${rankAssessment.code} · ${rankAssessment.title}`, 114, 265)

  const headerAvatarX = 746
  const headerAvatarY = 112
  const headerAvatarSize = 146
  const headerAvatarImage = printAvatarImage ?? (printAvatar.status === 'idle' ? bossImage : null)
  if (headerAvatarImage) {
    context.save()
    context.beginPath()
    context.roundRect(headerAvatarX, headerAvatarY, headerAvatarSize, headerAvatarSize, 8)
    context.clip()
    context.fillStyle = '#f2eadc'
    context.fillRect(headerAvatarX, headerAvatarY, headerAvatarSize, headerAvatarSize)
    drawThermalImage(context, () =>
      drawContainImage(
        context,
        headerAvatarImage,
        headerAvatarX,
        headerAvatarY,
        headerAvatarSize,
        headerAvatarSize,
      ),
    )
    context.restore()
    context.strokeStyle = ink
    context.lineWidth = 2
    context.strokeRect(headerAvatarX, headerAvatarY, headerAvatarSize, headerAvatarSize)
  }

  context.fillStyle = ink
  context.font = '900 19px sans-serif'
  context.fillText('NO.', 100, 320)
  context.font = '900 25px monospace'
  context.fillText(receiptNo, 148, 321)
  context.textAlign = 'right'
  context.font = '800 18px sans-serif'
  context.fillStyle = mutedInk
  context.fillText('热敏长票版', 900, 320)
  context.textAlign = 'left'
  drawReceiptLine(context, 72, 344, 856)

  drawReceiptBox(context, 72, quoteY, 856, quoteHeight, '#fffdf6')
  context.fillStyle = ink
  context.font = '900 29px sans-serif'
  context.fillText('01 经典语录解锁情况', 100, quoteY + 48)
  context.textAlign = 'right'
  context.fillStyle = mutedInk
  context.font = '900 18px sans-serif'
  context.fillText(`随机触发 ${classicQuotes.length} 条`, 900, quoteY + 48)
  context.textAlign = 'left'
  context.fillStyle = ink
  context.fillRect(100, quoteY + 74, 800, quoteHeight - 104)
  context.fillStyle = paper
  classicQuotes.forEach((classicQuote, index) => {
    const quoteLineY =
      classicQuotes.length === 1 ? quoteY + 156 : quoteY + 132 + index * 92
    if (index > 0) {
      context.strokeStyle = 'rgba(255, 253, 246, 0.28)'
      context.lineWidth = 2
      context.beginPath()
      context.moveTo(126, quoteLineY - 46)
      context.lineTo(874, quoteLineY - 46)
      context.stroke()
    }
    context.font = classicQuotes.length === 1 ? '900 52px sans-serif' : '900 38px sans-serif'
    context.fillText(`“${classicQuote.quote}”`, 128, quoteLineY)
    context.font = '900 20px sans-serif'
    context.fillStyle = 'rgba(255, 253, 246, 0.72)'
    context.fillText(`${classicQuote.company} · ${classicQuote.name}`, 132, quoteLineY + 36)
    context.fillStyle = paper
  })

  drawReceiptLine(context, 72, evidenceY - 30, 856)
  drawReceiptBox(context, 72, evidenceY, 856, evidenceHeight, sectionPaper)
  context.fillStyle = ink
  context.font = '900 28px sans-serif'
  context.fillText('02 钉钉工作群证据', 100, evidenceY + 46)
  context.textAlign = 'right'
  context.fillStyle = mutedInk
  context.font = '800 18px sans-serif'
  context.fillText('work · 证据截图', 900, evidenceY + 46)
  context.textAlign = 'left'

  const visualY = evidenceY + 70
  const visualHeight = 244
  const visualWidth = 382
  const visualCards = [
    {
      x: 100,
      label: '状态模拟图',
      tag: posterSceneLabel,
      draw: () => {
        if (statusVideoFrame) {
          drawContainVideo(context, statusVideoFrame, 116, visualY + 44, 350, 170)
        } else {
          context.fillStyle = '#f5efe4'
          context.fillRect(116, visualY + 44, 350, 170)
          context.fillStyle = ink
          context.font = '900 31px sans-serif'
          context.textAlign = 'center'
          context.fillText(scene.shortLabel, 291, visualY + 142)
          context.textAlign = 'left'
        }
      },
    },
    {
      x: 518,
      label: '眼镜拍摄图',
      tag: evidenceItem.scene || scene.shortLabel,
      draw: () => drawContainImage(context, evidenceImage, 534, visualY + 44, 350, 170),
    },
  ]

  visualCards.forEach((card) => {
    drawReceiptBox(context, card.x, visualY, visualWidth, visualHeight, '#fffdf6')
    context.fillStyle = ink
    context.beginPath()
    context.arc(card.x + 28, visualY + 27, 6, 0, Math.PI * 2)
    context.fill()
    context.font = '900 19px sans-serif'
    context.fillText('REC', card.x + 42, visualY + 34)
    context.textAlign = 'right'
    context.fillStyle = mutedInk
    context.font = '800 17px sans-serif'
    context.fillText(card.tag, card.x + visualWidth - 18, visualY + 34)
    context.textAlign = 'left'

    context.save()
    context.beginPath()
    context.rect(card.x + 16, visualY + 44, visualWidth - 32, 170)
    context.clip()
    context.fillStyle = '#f5efe4'
    context.fillRect(card.x + 16, visualY + 44, visualWidth - 32, 170)
    drawThermalImage(context, card.draw)
    context.restore()

    context.strokeStyle = faintInk
    context.lineWidth = 2
    context.strokeRect(card.x + 16, visualY + 44, visualWidth - 32, 170)
    context.fillStyle = ink
    context.font = '900 20px sans-serif'
    context.fillText(card.label, card.x + 18, visualY + 231)
  })

  drawReceiptBox(context, 100, evidenceY + 330, 800, 96, '#fffdf6')
  context.save()
  context.beginPath()
  context.roundRect(122, evidenceY + 350, 48, 48, 6)
  context.clip()
  context.fillStyle = '#f2eadc'
  context.fillRect(122, evidenceY + 350, 48, 48)
  drawThermalImage(context, () => drawContainImage(context, bossImage, 122, evidenceY + 350, 48, 48))
  context.restore()
  context.strokeStyle = ink
  context.lineWidth = 2
  context.strokeRect(122, evidenceY + 350, 48, 48)
  context.fillStyle = ink
  context.font = '900 21px sans-serif'
  context.fillText(evidenceItem.nickname || boss.name, 190, evidenceY + 366)
  context.fillStyle = mutedInk
  context.font = '800 16px sans-serif'
  context.fillText(formatChatTime(evidenceItem.createdAtIso), 190, evidenceY + 392)
  context.fillStyle = ink
  context.font = '900 17px sans-serif'
  drawWrappedText(context, evidenceItem.text, 360, evidenceY + 368, 500, 21, 3)

  drawReceiptLine(context, 72, transcriptY - 30, 856)
  drawReceiptBox(context, 72, transcriptY, 856, transcriptHeight, '#fffdf6')
  context.fillStyle = ink
  context.font = '900 28px sans-serif'
  context.fillText('03 工作群对话截取', 100, transcriptY + 48)
  context.textAlign = 'right'
  context.fillStyle = mutedInk
  context.font = '800 18px sans-serif'
  context.fillText(`含截图回执 · ${transcriptItems.length} 条`, 900, transcriptY + 48)
  context.textAlign = 'left'

  let transcriptCursorY = transcriptY + 78
  transcriptItems.forEach((item, index) => {
    const rowHeight = transcriptRowHeights[index]
    const isBossShout = item.id.endsWith('-poster-shout')
    const rowX = 100
    const rowWidth = 800
    context.fillStyle = isBossShout ? ink : index % 2 === 0 ? '#fffaf0' : '#fffdf6'
    context.fillRect(rowX, transcriptCursorY, rowWidth, rowHeight - 10)
    context.strokeStyle = isBossShout ? ink : faintInk
    context.lineWidth = isBossShout ? 3 : 2
    context.strokeRect(rowX, transcriptCursorY, rowWidth, rowHeight - 10)

    context.save()
    context.beginPath()
    context.roundRect(rowX + 18, transcriptCursorY + 18, 44, 44, 6)
    context.clip()
    context.fillStyle = isBossShout ? paper : '#f2eadc'
    context.fillRect(rowX + 18, transcriptCursorY + 18, 44, 44)
    if (item.type === 'criticism') {
      drawThermalImage(context, () => drawContainImage(context, bossImage, rowX + 18, transcriptCursorY + 18, 44, 44))
    } else {
      context.fillStyle = isBossShout ? ink : mutedInk
      context.font = '900 24px sans-serif'
      context.textAlign = 'center'
      context.fillText(item.nickname.slice(0, 1), rowX + 40, transcriptCursorY + 49)
      context.textAlign = 'left'
    }
    context.restore()

    context.fillStyle = isBossShout ? paper : ink
    context.font = '900 19px sans-serif'
    context.fillText(item.nickname || '群成员', rowX + 78, transcriptCursorY + 34)
    context.textAlign = 'right'
    context.fillStyle = isBossShout ? 'rgba(255, 253, 246, 0.72)' : mutedInk
    context.font = '800 16px sans-serif'
    context.fillText(formatChatTime(item.createdAtIso), rowX + rowWidth - 20, transcriptCursorY + 34)
    context.textAlign = 'left'
    context.fillStyle = isBossShout ? paper : ink
    context.font = isBossShout ? '900 29px sans-serif' : '900 17px sans-serif'
    drawWrappedText(
      context,
      item.text,
      rowX + 78,
      transcriptCursorY + 64,
      isBossShout ? 650 : 684,
      isBossShout ? 33 : 22,
      isBossShout ? 2 : 4,
    )
    if (item.imageUrl) {
      context.fillStyle = isBossShout ? paper : ink
      context.font = '900 15px sans-serif'
      context.fillText(`附图证据 · ${item.scene || posterSceneLabel}`, rowX + 78, transcriptCursorY + rowHeight - 24)
    }
    transcriptCursorY += rowHeight
  })

  drawReceiptLine(context, 72, metricY - 30, 856)
  drawReceiptBox(context, 72, metricY, 856, metricHeight, sectionPaper)
  context.fillStyle = ink
  context.font = '900 28px sans-serif'
  context.fillText('04 试炼数据回执', 100, metricY + 46)

  const metricGridX = 100
  const metricGridY = metricY + 70
  const metricCellWidth = 382
  const metricCellHeight = 54
  metrics.forEach((metric, index) => {
    const column = index % 2
    const row = Math.floor(index / 2)
    const x = metricGridX + column * 418
    const y = metricGridY + row * 62
    context.strokeStyle = faintInk
    context.lineWidth = 2
    context.strokeRect(x, y, metricCellWidth, metricCellHeight)
    context.fillStyle = mutedInk
    context.font = '900 20px sans-serif'
    context.fillText(metric.label, x + 16, y + 34)
    context.textAlign = 'right'
    context.fillStyle = ink
    context.font = '900 31px monospace'
    context.fillText(metric.value, x + metricCellWidth - 54, y + 38)
    context.font = '900 18px sans-serif'
    context.fillText(metric.suffix, x + metricCellWidth - 16, y + 36)
    context.textAlign = 'left'
  })

  drawReceiptLine(context, 72, rankY - 30, 856)
  drawReceiptBox(context, 72, rankY, 856, rankHeight, sectionPaper)
  context.fillStyle = ink
  context.font = '900 28px sans-serif'
  context.fillText('05 职级评定报告', 100, rankY + 46)
  context.font = '900 60px sans-serif'
  context.fillText(rankAssessment.code, 100, rankY + 118)
  context.font = '900 25px sans-serif'
  context.fillText(rankAssessment.title, 210, rankY + 94)
  context.fillStyle = mutedInk
  context.font = '900 18px sans-serif'
  drawWrappedText(context, rankAssessment.summary, 210, rankY + 126, 400, 24, 2)

  context.save()
  context.translate(782, rankY + 100)
  context.rotate(-0.18)
  context.strokeStyle = ink
  context.fillStyle = 'rgba(29, 24, 20, 0.03)'
  context.lineWidth = 6
  context.beginPath()
  context.ellipse(0, 0, 110, 70, 0, 0, Math.PI * 2)
  context.fill()
  context.stroke()
  context.lineWidth = 3
  context.beginPath()
  context.ellipse(0, 0, 90, 56, 0, 0, Math.PI * 2)
  context.stroke()
  context.fillStyle = ink
  context.font = '900 23px sans-serif'
  context.textAlign = 'center'
  context.fillText('阿里爸妈集团', 0, -8)
  context.font = '900 17px sans-serif'
  context.fillText('职级评定专用章', 0, 22)
  context.restore()

  context.fillStyle = ink
  context.font = '900 16px monospace'
  context.fillText('SIGN: PUA-TRIAL-RECEIPT', 100, footerY)
  context.textAlign = 'right'
  context.font = '900 15px sans-serif'
  context.fillText(`已落存 · ${savedAtText}`, 900, footerY)
  context.textAlign = 'left'

  return canvas.toDataURL('image/png')
}

const saveDepartmentPoster = async (
  imageDataUrl: string,
  sourceMessageId: string,
): Promise<ReportPosterResult> => {
  const filename = `department-poster-${sourceMessageId}-${Date.now()}.png`
  const fallback: ReportPosterResult = {
    ok: false,
    url: imageDataUrl,
    dataUrl: imageDataUrl,
    filename,
    savedAtIso: new Date().toISOString(),
    sourceMessageId,
  }

  try {
    const response = await fetch(REMOTE_REPORT_POSTER_UPLOAD_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'image/png',
        'X-Filename': filename,
      },
      body: await (await fetch(imageDataUrl)).blob(),
    })
    const payload = (await response.json()) as RemoteImageUploadResponse
    const uploaded = payload.item
    if (!response.ok || !payload.ok || !uploaded?.url || !uploaded.filename) {
      throw new Error('remote poster upload failed')
    }

    return {
      ok: true,
      url: addCacheBuster(uploaded.url, Date.now()),
      dataUrl: imageDataUrl,
      filename: uploaded.filename,
      savedAtIso: uploaded.modifiedAtIso ?? new Date().toISOString(),
      sourceMessageId,
    }
  } catch {
    // Fall through to local persistence so the demo can still print if the public server is down.
  }

  try {
    const response = await fetch(LOCAL_REPORT_POSTER_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageDataUrl,
        filename,
      }),
    })
    const payload = (await response.json()) as Partial<ReportPosterResult>
    if (!response.ok || !payload.ok || !payload.url || !payload.filename) {
      throw new Error('poster save failed')
    }

    return {
      ok: true,
      url: addCacheBuster(payload.url, Date.now()),
      dataUrl: imageDataUrl,
      filename: payload.filename,
      savedAtIso: payload.savedAtIso ?? new Date().toISOString(),
      sourceMessageId,
    }
  } catch {
    return fallback
  }
}

const loadStoredProfile = () => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.profile)
    if (!raw) return DEFAULT_PROFILE
    const parsed = JSON.parse(raw) as Partial<Profile>
    const categoryMode: Profile['categoryMode'] =
      parsed.categoryMode === 'manual' ? 'manual' : 'scene'
    const profile: Profile = {
      ...DEFAULT_PROFILE,
      ...parsed,
      categoryMode,
    }
    return profile
  } catch {
    return DEFAULT_PROFILE
  }
}

const loadStoredPrintAvatar = (): PrintAvatarState => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.printAvatar)
    if (!raw) return { status: 'idle', url: '' }
    const parsed = JSON.parse(raw) as Partial<PrintAvatarState>

    if (parsed.status === 'ready' && parsed.url) {
      return {
        status: 'ready',
        url: parsed.url,
        updatedAtIso: parsed.updatedAtIso,
      }
    }
    if (parsed.status === 'declined') {
      return {
        status: 'declined',
        url: '',
        updatedAtIso: parsed.updatedAtIso,
      }
    }
    if (parsed.status === 'error') {
      return {
        status: 'error',
        url: '',
        error: parsed.error,
        updatedAtIso: parsed.updatedAtIso,
      }
    }

    return { status: 'idle', url: '' }
  } catch {
    return { status: 'idle', url: '' }
  }
}

const requestCartoonAvatar = async (imageDataUrl: string) => {
  const response = await fetch(LOCAL_CARTOON_AVATAR_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageDataUrl }),
  })
  const payload = (await response.json()) as {
    ok?: boolean
    url?: string
    savedAtIso?: string
    error?: string
  }
  const avatarUrl = payload.url

  if (!response.ok || !payload.ok || !avatarUrl) {
    throw new Error(payload.error || 'avatar generation failed')
  }

  return {
    ok: true,
    url: avatarUrl,
    savedAtIso: payload.savedAtIso,
  }
}

const loadStoredBossId = (): BossId => {
  return 'ma'
}

const loadStoredSecondaryBossId = (): BossId | null => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.secondaryBossId) as BossId | null
    if (!raw || raw === 'ma') return null
    return BOSSES.some((boss) => boss.id === raw) ? raw : null
  } catch {
    return null
  }
}

const loadStoredOkrs = () => {
  const normalizeDue = (okr: OkrItem): OkrItem => ({ ...okr, due: KPI_DUE_LABEL })

  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.okrs)
    if (!raw) return INITIAL_OKRS.map(normalizeDue)

    const parsed = JSON.parse(raw) as OkrItem[]
    return Array.isArray(parsed) && parsed.length ? parsed.map(normalizeDue) : INITIAL_OKRS.map(normalizeDue)
  } catch {
    return INITIAL_OKRS.map(normalizeDue)
  }
}

const isDemoMode = () => {
  try {
    return new URLSearchParams(window.location.search).get('demo') === '1'
  } catch {
    return false
  }
}

const isSeedMode = () => {
  try {
    return isDemoMode() && new URLSearchParams(window.location.search).get('seed') === '1'
  } catch {
    return false
  }
}

const getInitialTab = (): TabId => {
  try {
    const tab = new URLSearchParams(window.location.search).get('tab')
    return tabs.some((item) => item.id === tab) ? (tab as TabId) : 'home'
  } catch {
    return 'home'
  }
}

const getInitialGroupView = () => {
  try {
    return new URLSearchParams(window.location.search).get('view') === 'reviews'
      ? 'reviews'
      : 'feed'
  } catch {
    return 'feed'
  }
}

const createSeedReports = () =>
  DEMO_SCRIPT.slice()
    .reverse()
    .map((step, index) => ({
      ...createReport(getScene(step.sceneId), getBoss('ma'), DEFAULT_PROFILE, null, index),
      id: `seed-${step.order}`,
      time: new Date(Date.now() - index * 84_000).toISOString(),
    }))

const loadStoredReports = () => {
  if (isSeedMode()) return createSeedReports()

  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.reports)
    if (!raw) return []

    const parsed = JSON.parse(raw) as ReportRecord[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const App = () => {
  const [activeTab, setActiveTab] = useState<TabId>(getInitialTab)
  const [currentSceneId, setCurrentSceneId] = useState<SceneId>('computer')
  const [currentBossId, setCurrentBossId] = useState<BossId>(loadStoredBossId)
  const [secondaryBossId, setSecondaryBossId] = useState<BossId | null>(loadStoredSecondaryBossId)
  const [profile, setProfile] = useState<Profile>(loadStoredProfile)
  const [okrs, setOkrs] = useState<OkrItem[]>(loadStoredOkrs)
  const [printAvatar, setPrintAvatar] = useState<PrintAvatarState>(loadStoredPrintAvatar)
  const [latestCapture, setLatestCapture] = useState<CaptureItem | null>(null)
  const [rokidStatus, setRokidStatus] = useState<RokidStatusResponse | null>(null)
  const [imageBroken, setImageBroken] = useState(false)
  const [syncState, setSyncState] = useState<SyncState>('idle')
  const [reports, setReports] = useState<ReportRecord[]>(loadStoredReports)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [jobHopOpen, setJobHopOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [kpiUpdateState, setKpiUpdateState] = useState<'idle' | 'talking' | 'waiting'>('idle')
  const [kpiActiveAction, setKpiActiveAction] = useState<KpiAction>('update')
  const [reportActionState, setReportActionState] = useState<'idle' | 'saved' | 'reset'>('idle')
  const [reportHistoryCleared, setReportHistoryCleared] = useState(false)
  const [reportResetNonce, setReportResetNonce] = useState(0)
  const [cutInVisible, setCutInVisible] = useState(false)
  const [cutInBossId, setCutInBossId] = useState<BossId>('ma')
  const reportActionTimerRef = useRef<number | null>(null)
  const cutInTimerRef = useRef<number | null>(null)
  const autoKpiCreatePendingRef = useRef(false)
  const avatarJobRef = useRef(0)
  const kpiSyncInFlightRef = useRef(false)
  const remoteKpiUpdatedAtRef = useRef(okrs[0]?.sourceUpdatedAtIso ?? '')
  const syncInFlightRef = useRef(false)
  const [hasOnboarded, setHasOnboarded] = useState(() => {
    try {
      return isDemoMode() || window.localStorage.getItem('pua-onboarded') === 'true'
    } catch {
      return false
    }
  })

  const currentScene = useMemo(() => getScene(currentSceneId), [currentSceneId])
  const currentBoss = useMemo(() => getBoss(currentBossId), [currentBossId])
  const cutInBoss = useMemo(() => getBoss(cutInBossId), [cutInBossId])
  const statusLabel = getStatusLabel(rokidStatus, currentScene)
  const statusVideo = getStatusVideo(statusLabel, currentScene)
  const showGlassesAlert = shouldShowGlassesAlert(statusLabel, currentScene)
  const isBossMeeting = isBossMeetingStatus(statusLabel)
  const tokenCost = reports.reduce((sum, report) => sum + getBoss(report.bossId).tokenCost, 0)
  const latestReport = reports[0]

  const notify = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2200)
  }, [])

  const markReportAction = useCallback((state: 'saved' | 'reset') => {
    setReportActionState(state)
    if (reportActionTimerRef.current) {
      window.clearTimeout(reportActionTimerRef.current)
    }
    reportActionTimerRef.current = window.setTimeout(() => {
      setReportActionState('idle')
      reportActionTimerRef.current = null
    }, 1400)
  }, [])

  const showBossCutIn = useCallback((bossId: BossId = 'ma') => {
    setCutInBossId(bossId)
    setCutInVisible(true)
    if (cutInTimerRef.current) {
      window.clearTimeout(cutInTimerRef.current)
    }
    cutInTimerRef.current = window.setTimeout(() => {
      setCutInVisible(false)
      cutInTimerRef.current = null
    }, 900)
  }, [])

  const playBossVoice = (boss: Boss) => {
    const audio = new Audio(boss.voiceSrc)
    audio.play().catch(() => undefined)
  }

  const selectDialogueBoss = (boss: Boss) => {
    const nextBossId = boss.id === 'ma' ? 'ma' : boss.id
    setCurrentBossId('ma')
    setSecondaryBossId(boss.id === 'ma' ? null : boss.id)
    showBossCutIn(nextBossId)

    void updateTtsVoice(nextBossId)
      .then(() => {
        notify(boss.id === 'ma' ? '主对话已确认' : `副对话已确认：${boss.name}`)
      })
      .catch(() => {
        notify('音色接口暂不可用')
      })
  }

  const handleDeclinePhoto = useCallback(() => {
    avatarJobRef.current += 1
    setPrintAvatar({
      status: 'declined',
      url: '',
      updatedAtIso: new Date().toISOString(),
    })
    setSettingsOpen(false)
    setActiveTab('okr')
    setKpiActiveAction('create')
    autoKpiCreatePendingRef.current = true
    notify('打印头像已留空，进入 KPI 创建')
  }, [notify])

  const handlePhotoCapture = useCallback(
    (imageDataUrl: string) => {
      const jobId = avatarJobRef.current + 1
      avatarJobRef.current = jobId
      setPrintAvatar({
        status: 'processing',
        url: '',
        updatedAtIso: new Date().toISOString(),
      })
      setSettingsOpen(false)
      setActiveTab('okr')
      setKpiActiveAction('create')
      autoKpiCreatePendingRef.current = true
      notify('照片已提交，进入 KPI 创建')

      void requestCartoonAvatar(imageDataUrl)
        .then((payload) => {
          if (avatarJobRef.current !== jobId) return
          setPrintAvatar({
            status: 'ready',
            url: addCacheBuster(payload.url, Date.now()),
            updatedAtIso: payload.savedAtIso ?? new Date().toISOString(),
          })
          notify('卡通打印头像已生成')
        })
        .catch((error) => {
          if (avatarJobRef.current !== jobId) return
          setPrintAvatar({
            status: 'error',
            url: '',
            error: error instanceof Error ? error.message : '头像生成失败',
            updatedAtIso: new Date().toISOString(),
          })
          notify('头像生成失败，打印时将留空')
        })
    },
    [notify],
  )

  const syncFromGlasses = useCallback(async () => {
    if (syncInFlightRef.current) return

    syncInFlightRef.current = true
    setSyncState('syncing')

    try {
      const status = await fetchRokidStatus()
      const nextSceneId = getSceneIdFromStatus(status)
      setRokidStatus(status)
      setCurrentSceneId(nextSceneId)

      if (status.capture?.url) {
        const readyCapture = {
          ...status.capture,
          url: addCacheBuster(status.capture.url, status.capture.modifiedAt ?? Date.now()),
        }
        await preloadImage(readyCapture.url)
        setLatestCapture(readyCapture)
        setImageBroken(false)
        setSyncState('success')
        return
      }

      const fallback = await fetchLatestCapture(ROKID_STATUS_CATEGORY)
      if (fallback.latest) {
        setLatestCapture(fallback.latest)
        setImageBroken(false)
        setSyncState('fallback')
        return
      }

      setLatestCapture(null)
      setImageBroken(false)
      setSyncState('fallback')
    } catch {
      try {
        const fallback = await fetchLatestCapture(ROKID_STATUS_CATEGORY)

        if (fallback.latest) {
          setLatestCapture(fallback.latest)
          setImageBroken(false)
          setSyncState('fallback')
          return
        }
      } catch {
        // Keep the homepage usable even if both backend paths are temporarily unavailable.
      }

      setLatestCapture(null)
      setRokidStatus(null)
      setImageBroken(false)
      setSyncState('error')
    } finally {
      syncInFlightRef.current = false
    }
  }, [])

  const saveReportSnapshot = () => {
    const capture = latestCapture
    const nextReports = reports.length
      ? reports
      : [createReport(currentScene, currentBoss, profile, capture, 0)]
    setReports(nextReports)
    setReportHistoryCleared(false)
    window.localStorage.setItem(STORAGE_KEYS.reports, JSON.stringify(nextReports.slice(0, 60)))
    markReportAction('saved')
    notify('报告已保存')
  }

  const resetReportSnapshot = () => {
    setReports([])
    setReportHistoryCleared(true)
    setReportResetNonce((previous) => previous + 1)
    window.localStorage.removeItem(STORAGE_KEYS.reports)
    window.localStorage.removeItem(STORAGE_KEYS.latestPoster)
    markReportAction('reset')
    notify('历史记录和评定结果已清除')
  }

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.profile, JSON.stringify(profile))
  }, [profile])

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.printAvatar, JSON.stringify(printAvatar))
  }, [printAvatar])

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.bossId, currentBossId)
  }, [currentBossId])

  useEffect(() => {
    if (secondaryBossId) {
      window.localStorage.setItem(STORAGE_KEYS.secondaryBossId, secondaryBossId)
    } else {
      window.localStorage.removeItem(STORAGE_KEYS.secondaryBossId)
    }
  }, [secondaryBossId])

  useEffect(() => {
    if (hasSyncedInitialTtsVoice) return
    hasSyncedInitialTtsVoice = true
    void updateTtsVoice(secondaryBossId ?? 'ma').catch(() => undefined)
  }, [secondaryBossId])

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.okrs, JSON.stringify(okrs))
  }, [okrs])

  useEffect(() => {
    if (isSeedMode()) return
    window.localStorage.setItem(STORAGE_KEYS.reports, JSON.stringify(reports.slice(0, 60)))
  }, [reports])

  useEffect(() => {
    if (!settingsOpen) return undefined

    const closeSettingsOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSettingsOpen(false)
      }
    }

    window.addEventListener('keydown', closeSettingsOnEscape)

    return () => window.removeEventListener('keydown', closeSettingsOnEscape)
  }, [settingsOpen])

  useEffect(
    () => () => {
      if (reportActionTimerRef.current) {
        window.clearTimeout(reportActionTimerRef.current)
      }
      if (cutInTimerRef.current) {
        window.clearTimeout(cutInTimerRef.current)
      }
    },
    [],
  )

  useEffect(() => {
    if (activeTab !== 'home') return undefined

    const initialTimer = window.setTimeout(() => {
      void syncFromGlasses()
    }, 0)
    const pollTimer = window.setInterval(() => {
      void syncFromGlasses()
    }, 2000)

    return () => {
      window.clearTimeout(initialTimer)
      window.clearInterval(pollTimer)
    }
  }, [activeTab, syncFromGlasses])

  const updateOkrProgress = (id: string, progress: number) => {
    setOkrs((previous) =>
      previous.map((okr) => (okr.id === id ? { ...okr, progress } : okr)),
    )
  }

  const syncRemoteKpi = useCallback(
    async ({
      announce = false,
      signal,
      showStatus = false,
    }: {
      announce?: boolean
      signal?: AbortSignal
      showStatus?: boolean
    } = {}) => {
      if (kpiSyncInFlightRef.current) return

      kpiSyncInFlightRef.current = true
      if (showStatus) {
        setKpiActiveAction('create')
        setKpiUpdateState('talking')
      }

      try {
        const payload = await fetchRemoteKpi(signal)
        const nextUpdatedAt = payload.updatedAtIso ?? JSON.stringify(getRemoteKpiPoints(payload))

        if (nextUpdatedAt && remoteKpiUpdatedAtRef.current !== nextUpdatedAt) {
          setOkrs((previous) => {
            const current = previous[0] ?? INITIAL_OKRS[0]
            const nextKpi = toRemoteKpiItem({ ...payload, updatedAtIso: nextUpdatedAt }, current)
            return nextKpi ? [nextKpi, ...previous.slice(1)] : previous
          })
          remoteKpiUpdatedAtRef.current = nextUpdatedAt
          if (announce) notify('KPI 已从老板接口同步')
        }
      } catch {
        if (announce) notify('KPI 接口暂不可用')
      } finally {
        if (showStatus) {
          setKpiUpdateState('idle')
        }
        kpiSyncInFlightRef.current = false
      }
    },
    [notify],
  )

  useEffect(() => {
    if (!autoKpiCreatePendingRef.current || activeTab !== 'okr') return undefined

    const createTimer = window.setTimeout(() => {
      if (!autoKpiCreatePendingRef.current) return

      autoKpiCreatePendingRef.current = false
      void syncRemoteKpi({ announce: true, showStatus: true })
    }, 0)

    return () => window.clearTimeout(createTimer)
  }, [activeTab, syncRemoteKpi])

  useEffect(() => {
    if (activeTab !== 'okr') return undefined

    const controller = new AbortController()
    const initialKpiTimer = window.setTimeout(() => {
      void syncRemoteKpi({ signal: controller.signal, showStatus: true })
    }, 0)
    const kpiPollTimer = window.setInterval(() => {
      void syncRemoteKpi({ signal: controller.signal })
    }, 30_000)

    return () => {
      controller.abort()
      window.clearTimeout(initialKpiTimer)
      window.clearInterval(kpiPollTimer)
    }
  }, [activeTab, syncRemoteKpi])

  const completeOnboarding = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()
    window.localStorage.setItem('pua-onboarded', 'true')
    setHasOnboarded(true)
    setActiveTab('okr')
    showBossCutIn(currentBoss.id)
    notify(`KPI 已设定，${currentBoss.name}开始拷打`)
  }

  return (
    <main className="app-shell">
      <section
        className={activeTab === 'home' ? 'phone-frame' : 'phone-frame no-page-header'}
        aria-label="全天候大厂 PUA 模拟器"
      >
        {activeTab === 'home' && (
          <AppHeader
            boss={currentBoss}
            onOpenJobHop={() => setJobHopOpen(true)}
            onOpenSettings={() => setSettingsOpen(true)}
            syncState={syncState}
          />
        )}

        <div className="screen-body">
          {activeTab === 'home' && (
            <HomePanel
              currentScene={currentScene}
              latestCapture={latestCapture}
              statusVideo={statusVideo}
              statusLabel={statusLabel}
              showGlassesAlert={showGlassesAlert}
              isBossMeeting={isBossMeeting}
              imageBroken={imageBroken}
              onImageError={() => setImageBroken(true)}
            />
          )}

          {activeTab === 'group' && (
            <GroupPanel
              boss={currentBoss}
              latestReport={latestReport}
              printAvatar={printAvatar}
              profile={profile}
              reportHistoryCleared={reportHistoryCleared}
              reportActionState={reportActionState}
              reportResetNonce={reportResetNonce}
              reports={reports}
              tokenCost={tokenCost}
              onResetReports={resetReportSnapshot}
              onSaveReports={saveReportSnapshot}
            />
          )}

          {activeTab === 'okr' && (
            <OkrPanel
              boss={currentBoss}
              okrs={okrs}
              activeAction={kpiActiveAction}
              updateState={kpiUpdateState}
              onUpdateOkrProgress={updateOkrProgress}
            />
          )}

        </div>

        <BottomTabs activeTab={activeTab} onChange={setActiveTab} reportsCount={reports.length} />

        {settingsOpen && (
          <SettingsPanel
            onCapturePhoto={handlePhotoCapture}
            onClose={() => setSettingsOpen(false)}
            onDeclinePhoto={handleDeclinePhoto}
          />
        )}

        {jobHopOpen && (
          <JobHopPanel
            bosses={BOSSES}
            currentBossId={currentBossId}
            secondaryBossId={secondaryBossId}
            onClose={() => setJobHopOpen(false)}
            onConfirmBoss={selectDialogueBoss}
            onPreviewVoice={playBossVoice}
          />
        )}

        {!hasOnboarded && !isDemoMode() && (
          <OnboardingPanel
            okrs={okrs}
            profile={profile}
            onComplete={completeOnboarding}
            setProfile={setProfile}
            setOkrs={setOkrs}
          />
        )}

        {cutInVisible && <BossCutIn boss={cutInBoss} scene={currentScene} />}

        <div className="toast" aria-live="polite">
          {toast}
        </div>
      </section>
    </main>
  )
}

type AppHeaderProps = {
  boss: Boss
  syncState: SyncState
  onOpenJobHop: () => void
  onOpenSettings: () => void
}

const AppHeader = ({ boss, syncState, onOpenJobHop, onOpenSettings }: AppHeaderProps) => (
  <header className="app-header">
    <button className="job-hop-top-button" type="button" onClick={onOpenJobHop}>
      <BriefcaseBusiness aria-hidden="true" size={17} />
      <span>跳槽</span>
    </button>
    <div className="header-boss-lockup">
      <BossAvatar boss={boss} />
      <strong>{boss.company} · {boss.name}</strong>
    </div>
    <button className="icon-button settings-button" type="button" onClick={onOpenSettings}>
      <Settings aria-hidden="true" size={25} />
      <span>设置</span>
    </button>
    <span className={`sync-dot ${syncState}`} aria-hidden="true" />
  </header>
)

type HomePanelProps = {
  currentScene: Scene
  latestCapture: CaptureItem | null
  statusVideo: StatusVideo
  statusLabel: string
  showGlassesAlert: boolean
  isBossMeeting: boolean
  imageBroken: boolean
  onImageError: () => void
}

const HomePanel = ({
  currentScene,
  latestCapture,
  statusVideo,
  statusLabel,
  showGlassesAlert,
  isBossMeeting,
  imageBroken,
  onImageError,
}: HomePanelProps) => {
  const [loadedCaptureUrl, setLoadedCaptureUrl] = useState('')
  const bossCallVideoRef = useRef<HTMLVideoElement | null>(null)
  const bossMeetingSequenceRef = useRef(false)
  const captureImageReady = Boolean(
    latestCapture?.url && !imageBroken && loadedCaptureUrl === latestCapture.url,
  )

  useEffect(() => {
    const video = bossCallVideoRef.current
    if (!video) return

    if (!isBossMeeting) {
      bossMeetingSequenceRef.current = false
      video.dataset.active = 'false'
      video.pause()
      video.currentTime = 0
      return
    }

    if (bossMeetingSequenceRef.current) return

    bossMeetingSequenceRef.current = true
    video.dataset.active = 'true'
    video.currentTime = 0
    void video.play().catch(() => {
      video.dataset.active = 'false'
    })
  }, [isBossMeeting])

  return (
    <section className="home-one-screen">
      <div className="pixel-panel home-status-stage">
        <div className="home-match-image" aria-label={`${currentScene.shortLabel}状态匹配图`}>
          <video
            key={statusVideo.src}
            className="home-status-video"
            src={statusVideo.src}
            width={statusVideo.width}
            height={statusVideo.height}
            style={{ aspectRatio: `${statusVideo.width} / ${statusVideo.height}` }}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            onCanPlay={(event) => {
              void event.currentTarget.play().catch(() => undefined)
            }}
          />
          <span className="home-image-tag">{statusLabel}</span>
        </div>
      </div>

      <div className="pixel-panel glasses-composite-card">
        <div
          className={
            captureImageReady
              ? 'glasses-composite-visual has-live-image'
              : 'glasses-composite-visual'
          }
          aria-label="眼镜实时画面"
        >
          <span className="home-rec-badge">REC</span>
          {latestCapture && (
            <img
              className={captureImageReady ? 'ready' : ''}
              src={latestCapture.url}
              alt="当前眼镜实时采集画面"
              onLoad={() => setLoadedCaptureUrl(latestCapture.url)}
              onError={onImageError}
            />
          )}
          <span className="glasses-scan-overlay" aria-hidden="true" />
          {showGlassesAlert && (
            <img
              className="glasses-alert-gif"
              src="/effects/big-eye.gif"
              alt=""
              aria-hidden="true"
            />
          )}
          <video
            ref={bossCallVideoRef}
            className="glasses-boss-call-video"
            src={BOSS_CALL_VIDEO_SRC}
            data-active="false"
            muted
            playsInline
            preload="auto"
            onEnded={(event) => {
              event.currentTarget.dataset.active = 'false'
            }}
            onError={(event) => {
              event.currentTarget.dataset.active = 'false'
            }}
            aria-hidden="true"
          />
          <span className="glasses-half-frame glasses-half-frame-left" aria-hidden="true" />
          <span className="glasses-half-frame glasses-half-frame-right" aria-hidden="true" />
          <span className="glasses-bridge" aria-hidden="true" />
        </div>
      </div>
    </section>
  )
}

type GroupPanelProps = {
  boss: Boss
  latestReport?: ReportRecord
  printAvatar: PrintAvatarState
  profile: Profile
  reportHistoryCleared: boolean
  reportActionState: 'idle' | 'saved' | 'reset'
  reportResetNonce: number
  reports: ReportRecord[]
  tokenCost: number
  onResetReports: () => void
  onSaveReports: () => void
}

const GroupPanel = ({
  boss,
  latestReport,
  printAvatar,
  profile,
  reportHistoryCleared,
  reportActionState,
  reportResetNonce,
  reports,
  tokenCost,
  onResetReports,
  onSaveReports,
}: GroupPanelProps) => {
  const [view, setView] = useState<'feed' | 'reviews'>(getInitialGroupView)
  const [screenshotStage, setScreenshotStage] = useState<
    'idle' | 'generating' | 'captured' | 'shout' | 'error'
  >('idle')
  const [posterPreview, setPosterPreview] = useState<ReportPosterResult | null>(null)
  const [posterError, setPosterError] = useState('')
  const screenshotTimerRef = useRef<number | null>(null)
  const posterFlashTimerRef = useRef<number | null>(null)
  const seedDisplayReports = useMemo(() => createSeedReports().slice(0, 1), [])
  const displayReports = reports.length ? reports : reportHistoryCleared ? [] : seedDisplayReports
  const primaryReport = latestReport ?? displayReports[0] ?? seedDisplayReports[0]
  const primaryScene = getScene(primaryReport.sceneId)
  const averageFish = displayReports.length
    ? Math.round(displayReports.reduce((sum, report) => sum + report.metrics.fish, 0) / displayReports.length)
    : 0
  const averageClosure = displayReports.length
    ? Math.round(displayReports.reduce((sum, report) => sum + report.metrics.closure, 0) / displayReports.length)
    : 0
  const fishValue = clampMetric(averageFish)
  const pressureValue = clampMetric(averageClosure)
  const rankAssessment = getRankAssessment(fishValue, pressureValue)
  const verdict =
    reportHistoryCleared && !displayReports.length
      ? '暂无评定结果。历史记录已清除，等待下一次眼镜截图和工作群记录生成新的职级评定报告。'
      : `${boss.name}总结评定：${profile.userName}本轮处于「${primaryScene.shortLabel}」，证据链已经进入钉钉工作群，摸鱼值 ${fishValue}、抗压力 ${pressureValue}，职级评定为 ${rankAssessment.code}「${rankAssessment.title}」。${rankAssessment.summary} 建议先补一条明确产出，再让 Leader 截图留痕，避免总裁 Token 继续燃烧。`
  const saveLabel = reportActionState === 'saved' ? '已存' : '保存'
  const resetLabel = reportActionState === 'reset' ? '已清' : '重置'
  const groupChatInput = useMemo(
    () => ({
      boss,
      profile,
      report: primaryReport,
      scene: primaryScene,
    }),
    [boss, primaryReport, primaryScene, profile],
  )
  const [groupChatFeed, setGroupChatFeed] = useState<GroupChatFeed>(() =>
    reportHistoryCleared ? createEmptyGroupChatFeed(profile) : createFallbackGroupChatFeed(groupChatInput),
  )
  const [groupChatStatus, setGroupChatStatus] = useState<'idle' | 'loading' | 'ready' | 'fallback'>('idle')
  const chatFeedRef = useRef<HTMLDivElement | null>(null)
  const groupChatStatusLabel = reportHistoryCleared
    ? '已清空'
    : groupChatStatus === 'loading'
      ? '生成中'
      : `${groupChatFeed.groupId} · ${groupChatFeed.count} 条消息`
  const criticismItems = groupChatFeed.items.filter((item) => item.type === 'criticism')
  const evidenceItems = groupChatFeed.items.filter((item) => item.imageUrl)
  const fishEvidenceCount = evidenceItems.filter((item) =>
    /看手机|摸鱼|朋友|聊天/.test(item.scene || item.previousScene),
  ).length
  const reportFishCount = displayReports.filter((report) => report.metrics.fish >= 65).length
  const reportCompletedCount = displayReports.filter((report) => report.metrics.closure >= 60).length
  const reportPuaCount = displayReports.filter((report) => report.metrics.pua >= 80).length
  const effectiveFishCount = Math.max(fishEvidenceCount, reportFishCount)
  const feedCriticismCount = criticismItems.length
  const completedReportCount = Math.max(evidenceItems.length, reportCompletedCount)
  const puaCount = Math.max(criticismItems.length, reportPuaCount)
  const goldenQuoteCount = groupChatFeed.items.filter((item) => item.text.trim()).length
  const presidentTokenCount = reportHistoryCleared ? 0 : Math.max(DEFAULT_PRESIDENT_TOKEN_COUNT, tokenCost)
  const latestEvidenceItem = useMemo(
    () => groupChatFeed.items.slice().reverse().find((item) => item.imageUrl),
    [groupChatFeed.items],
  )
  const posterMetrics = useMemo<PosterMetric[]>(
    () => [
      { label: '有效摸鱼', value: `${effectiveFishCount}`, suffix: '次' },
      { label: '通报批评', value: `${feedCriticismCount}`, suffix: '次' },
      { label: '完成报告', value: `${completedReportCount}`, suffix: '次' },
      { label: '被PUA', value: `${puaCount}`, suffix: '次' },
      { label: '触发金句', value: `${goldenQuoteCount}`, suffix: '次' },
      { label: '消耗总裁Token', value: `${presidentTokenCount}`, suffix: '' },
    ],
    [
      completedReportCount,
      effectiveFishCount,
      feedCriticismCount,
      goldenQuoteCount,
      presidentTokenCount,
      puaCount,
    ],
  )
  const screenshotButtonLabel =
    screenshotStage === 'generating'
      ? '生成截图中'
      : screenshotStage === 'error'
        ? posterError || '截图失败'
        : screenshotStage === 'idle'
          ? groupChatFeed.screenshot.idleText
          : groupChatFeed.screenshot.capturedText

  const triggerScreenshotNotice = async () => {
    if (screenshotStage === 'generating') return
    if (!latestEvidenceItem) {
      setPosterError('暂无可截图消息')
      setScreenshotStage('error')
      return
    }

    setPosterError('')
    setScreenshotStage('generating')
    if (screenshotTimerRef.current) {
      window.clearTimeout(screenshotTimerRef.current)
    }
    if (posterFlashTimerRef.current) {
      window.clearTimeout(posterFlashTimerRef.current)
    }

    try {
      const imageDataUrl = await createDepartmentPosterImage({
        boss,
        evidenceItem: latestEvidenceItem,
        groupFeed: groupChatFeed,
        metrics: posterMetrics,
        printAvatar,
        profile,
        rankAssessment,
        scene: primaryScene,
      })
      const savedPoster = await saveDepartmentPoster(imageDataUrl, latestEvidenceItem.id)
      setPosterPreview(savedPoster)
      const storedPoster = {
        ok: savedPoster.ok,
        url: savedPoster.url,
        filename: savedPoster.filename,
        savedAtIso: savedPoster.savedAtIso,
        sourceMessageId: savedPoster.sourceMessageId,
      }
      window.localStorage.setItem(STORAGE_KEYS.latestPoster, JSON.stringify(storedPoster))
      setScreenshotStage('captured')
      posterFlashTimerRef.current = window.setTimeout(() => {
        setPosterPreview(null)
        posterFlashTimerRef.current = null
      }, 1250)
      screenshotTimerRef.current = window.setTimeout(() => {
        setScreenshotStage('shout')
        screenshotTimerRef.current = null
      }, 720)
    } catch (error) {
      setPosterError(error instanceof Error ? error.message : '截图生成失败')
      setScreenshotStage('error')
    }
  }

  const scrollChatToBottom = useCallback(() => {
    const chatFeed = chatFeedRef.current
    if (!chatFeed) return

    chatFeed.scrollTop = chatFeed.scrollHeight
  }, [])

  useEffect(
    () => () => {
      if (screenshotTimerRef.current) {
        window.clearTimeout(screenshotTimerRef.current)
      }
      if (posterFlashTimerRef.current) {
        window.clearTimeout(posterFlashTimerRef.current)
      }
    },
    [],
  )

  useEffect(() => {
    if (!reportResetNonce) return undefined

    const frameId = window.requestAnimationFrame(() => {
      setPosterPreview(null)
      setPosterError('')
      setScreenshotStage('idle')
      setGroupChatFeed(createEmptyGroupChatFeed(profile))
      setGroupChatStatus('idle')
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [profile, reportResetNonce])

  useEffect(() => {
    if (reportHistoryCleared) {
      const frameId = window.requestAnimationFrame(() => {
        setGroupChatFeed(createEmptyGroupChatFeed(profile))
        setGroupChatStatus('idle')
      })

      return () => window.cancelAnimationFrame(frameId)
    }

    if (view !== 'feed') return undefined

    const controller = new AbortController()
    let cancelled = false
    const requestTimer = window.setTimeout(() => {
      setGroupChatStatus('loading')
      void fetchGroupChatFeed(groupChatInput, controller.signal)
        .then((feed) => {
          if (cancelled) return
          setGroupChatFeed(feed)
          setGroupChatStatus(feed.source === 'api' ? 'ready' : 'fallback')
        })
        .catch(() => {
          if (cancelled) return
          setGroupChatFeed(createFallbackGroupChatFeed(groupChatInput))
          setGroupChatStatus('fallback')
        })
    }, 0)

    return () => {
      cancelled = true
      controller.abort()
      window.clearTimeout(requestTimer)
    }
  }, [groupChatInput, profile, reportHistoryCleared, view])

  useEffect(() => {
    if (view !== 'feed') return

    const frameId = window.requestAnimationFrame(scrollChatToBottom)
    const shortTimer = window.setTimeout(scrollChatToBottom, 120)
    const imageTimer = window.setTimeout(scrollChatToBottom, 520)
    const settledTimer = window.setTimeout(scrollChatToBottom, 1100)

    return () => {
      window.cancelAnimationFrame(frameId)
      window.clearTimeout(shortTimer)
      window.clearTimeout(imageTimer)
      window.clearTimeout(settledTimer)
    }
  }, [groupChatFeed.items, screenshotStage, scrollChatToBottom, view])

  return (
    <section className="panel-stack group-screen">
      <div className="report-topbar">
        <button
          className={reportActionState === 'saved' ? 'report-corner-action confirmed' : 'report-corner-action'}
          type="button"
          onClick={onSaveReports}
        >
          <Save aria-hidden="true" size={14} />
          {saveLabel}
        </button>
        <div className="segmented-header">
          <button
            className={view === 'feed' ? 'active' : ''}
            type="button"
            onClick={() => setView('feed')}
          >
            部门大群
          </button>
          <button
            className={view === 'reviews' ? 'active' : ''}
            type="button"
            onClick={() => setView('reviews')}
          >
            评定结果
          </button>
        </div>
        <button
          className={reportActionState === 'reset' ? 'report-corner-action confirmed' : 'report-corner-action'}
          type="button"
          onClick={onResetReports}
        >
          <RotateCcw aria-hidden="true" size={14} />
          {resetLabel}
        </button>
      </div>

      {view === 'feed' ? (
        <div className="pixel-panel department-chat-panel">
          <div className="group-chat-title">
            <BossAvatar boss={boss} />
            <div>
              <p className="eyebrow">钉钉工作群</p>
              <h2>部门大群</h2>
            </div>
            <span>{groupChatStatusLabel}</span>
          </div>

          <div className="chat-feed realistic-feed" ref={chatFeedRef}>
            {!groupChatFeed.items.length && (
              <div className="empty-group-history">
                <ClipboardList aria-hidden="true" size={22} />
                <strong>暂无工作群历史</strong>
                <span>点击保存或等待下一次接口消息后生成新的群聊记录。</span>
              </div>
            )}

            {groupChatFeed.items.map((item) => (
              <article className={`chat-record group-message ${item.type}`} key={item.id}>
                <ChatAvatar
                  avatarUrl={item.avatarUrl}
                  boss={boss}
                  nickname={item.nickname}
                  useBossFallback={item.type === 'criticism'}
                />
                <div className={item.imageUrl ? 'chat-bubble has-message-image' : 'chat-bubble'}>
                  <div className="bubble-head">
                    <strong>{item.nickname}</strong>
                    <span>{formatChatTime(item.createdAtIso)}</span>
                  </div>
                  <p className={item.type === 'criticism' ? 'mention' : undefined}>{item.text}</p>
                  {item.imageUrl && (
                    <div className="evidence-card">
                      <span className="rec-stamp">REC</span>
                      <img
                        src={item.imageUrl}
                        alt={`${item.nickname}发送的截图`}
                        onLoad={scrollChatToBottom}
                      />
                      <span className="evidence-status-tag">{item.scene || primaryScene.shortLabel}</span>
                      <div>
                        <span>{item.category || 'rokid'}</span>
                        <strong>{formatChatTime(item.createdAtIso)}</strong>
                        <em>{item.filename || '未命名截图'}</em>
                      </div>
                    </div>
                  )}
                </div>
              </article>
            ))}

            <button
              className={screenshotStage === 'idle' ? 'screenshot-notice' : 'screenshot-notice captured'}
              type="button"
              onClick={triggerScreenshotNotice}
              disabled={screenshotStage === 'generating'}
            >
              <ClipboardList aria-hidden="true" size={18} />
              <span>{screenshotButtonLabel}</span>
            </button>

            {screenshotStage === 'shout' && (
              <article className="chat-record boss-shout">
                <BossAvatar boss={boss} />
                <div className="chat-bubble">
                  <strong>{groupChatFeed.screenshot.shoutText}</strong>
                </div>
              </article>
            )}
          </div>

          <div className="feed-count-strip">
            <MetricTile icon={Coffee} label="有效摸鱼" value={`${effectiveFishCount}`} suffix="次" />
            <MetricTile icon={BellRing} label="通报批评" value={`${feedCriticismCount}`} suffix="次" />
          </div>

          {posterPreview && (
            <div className="screenshot-flash-overlay" aria-hidden="true">
              <img src={posterPreview.dataUrl} alt="" />
            </div>
          )}
        </div>
      ) : (
        <div className="pixel-panel review-simple-panel">
          <div className="review-simple-head">
            <div>
              <p className="eyebrow">评定结果</p>
              <h2>职级评定报告</h2>
            </div>
            <BadgeCheck aria-hidden="true" size={24} />
          </div>
          <p className="review-verdict">{verdict}</p>
          <div className="review-rank-card">
            <strong>{rankAssessment.code}</strong>
            <em>{rankAssessment.title}</em>
            <p>{rankAssessment.summary}</p>
            <div className="ali-stamp" aria-hidden="true">
              <strong>阿里爸妈集团</strong>
              <span>职级评定专用章</span>
            </div>
          </div>
          <div className="review-progress-stack">
            <MetricBar label="摸鱼值" value={fishValue} />
            <MetricBar label="抗压力" value={pressureValue} />
          </div>
          <div className="review-stat-grid">
            <MetricTile icon={ClipboardList} label="完成报告" value={`${completedReportCount}`} suffix="次" />
            <MetricTile icon={ShieldAlert} label="被PUA" value={`${puaCount}`} suffix="次" />
            <MetricTile icon={MessageSquareText} label="触发金句" value={`${goldenQuoteCount}`} suffix="次" />
            <MetricTile icon={Zap} label="消耗总裁Token" value={`${presidentTokenCount}`} suffix="" />
          </div>
        </div>
      )}
    </section>
  )
}

type OkrPanelProps = {
  activeAction: KpiAction
  boss: Boss
  okrs: OkrItem[]
  updateState: 'idle' | 'talking' | 'waiting'
  onUpdateOkrProgress: (id: string, progress: number) => void
}

const OkrPanel = ({
  activeAction,
  boss,
  okrs,
  updateState,
  onUpdateOkrProgress,
}: OkrPanelProps) => {
  const currentKpi = okrs[0] ?? INITIAL_OKRS[0]
  const totalTodos = Math.max(1, currentKpi.keyResults.length)
  const completedTodos = Math.min(totalTodos, Math.round((currentKpi.progress / 100) * totalTodos))
  const bossNoteStatus =
    updateState === 'talking'
      ? activeAction === 'create'
        ? '正在创建 KPI'
        : '正在更新 KPI'
      : updateState === 'waiting'
        ? activeAction === 'create'
          ? '等待 Agent 创建 KPI'
          : '等待 Agent 更新 KPI'
        : ''

  const toggleTodo = (index: number, checked: boolean) => {
    const nextCompleted = checked
      ? Math.max(completedTodos, index + 1)
      : Math.min(completedTodos, index)
    const nextProgress = clampMetric(Math.round((Math.max(0, nextCompleted) / totalTodos) * 100))
    onUpdateOkrProgress(currentKpi.id, nextProgress)
  }

  return (
    <section className="panel-stack kpi-screen">
      <div className="pixel-panel current-kpi-panel">
        <div className="current-kpi-head">
          <div>
            <p className="eyebrow">当前 KPI</p>
            <h2>{currentKpi.objective}</h2>
            <span>{KPI_DUE_LABEL}</span>
          </div>
          <ClipboardList aria-hidden="true" size={25} />
        </div>
        <div className="kpi-progress">
          <MetricBar label="完成度" value={currentKpi.progress} />
          <strong>{completedTodos}/{totalTodos}</strong>
        </div>
        <div className="kpi-todo-list" aria-label="当前 KPI todo list">
          {currentKpi.keyResults.map((todo, index) => {
            const checked = index < completedTodos
            return (
              <label className={checked ? 'done' : ''} key={`${currentKpi.id}-${todo}`}>
                <input
                  checked={checked}
                  type="checkbox"
                  onChange={(event) => toggleTodo(index, event.target.checked)}
                />
                <i>{String(index + 1).padStart(2, '0')}</i>
                <span>{todo}</span>
                <em>{checked ? '已完成' : '待验收'}</em>
              </label>
            )
          })}
        </div>
        <div className={updateState === 'idle' ? 'boss-kpi-note' : 'boss-kpi-note active'}>
          <AliValuesCard />
          <div className="boss-kpi-note-copy">
            <strong>{boss.name}价值观抽检</strong>
            <p>{currentKpi.pressurePoint}</p>
          </div>
          {bossNoteStatus && <span className="boss-note-status">{bossNoteStatus}</span>}
        </div>
      </div>
    </section>
  )
}

type SettingsPanelProps = {
  onCapturePhoto: (imageDataUrl: string) => void
  onClose: () => void
  onDeclinePhoto: () => void
}

const SettingsPanel = ({
  onCapturePhoto,
  onClose,
  onDeclinePhoto,
}: SettingsPanelProps) => {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [cameraState, setCameraState] = useState<'idle' | 'starting' | 'ready' | 'blocked'>('idle')
  const [cameraError, setCameraError] = useState('')

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [])

  const startCamera = async () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setCameraError('')

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState('blocked')
      setCameraError('当前浏览器无法调用摄像头')
      return
    }

    setCameraState('starting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: 'user',
          height: { ideal: 1024 },
          width: { ideal: 1024 },
        },
      })

      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => undefined)
      }
      setCameraState('ready')
    } catch {
      setCameraState('blocked')
      setCameraError('摄像头未授权或不可用')
    }
  }

  const capturePhoto = () => {
    const video = videoRef.current
    if (!video || !video.videoWidth || !video.videoHeight) return

    const sourceSize = Math.min(video.videoWidth, video.videoHeight)
    const sourceX = (video.videoWidth - sourceSize) / 2
    const sourceY = (video.videoHeight - sourceSize) / 2
    const canvas = document.createElement('canvas')
    canvas.width = 768
    canvas.height = 768
    const context = canvas.getContext('2d')
    if (!context) return

    context.drawImage(video, sourceX, sourceY, sourceSize, sourceSize, 0, 0, 768, 768)
    onCapturePhoto(canvas.toDataURL('image/jpeg', 0.88))
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <aside
        aria-labelledby="settings-title"
        aria-modal="true"
        className="settings-panel pixel-panel"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">设置</p>
            <h2 id="settings-title">打印头像</h2>
          </div>
          <button aria-label="关闭设置" className="icon-button" type="button" onClick={onClose}>
            <X aria-hidden="true" size={22} />
          </button>
        </div>

        <div className="photo-capture-stage">
          {cameraState === 'idle' ? (
            <div className="photo-camera-blocked">
              <Camera aria-hidden="true" size={34} />
              <strong>点击下方按钮打开摄像头</strong>
            </div>
          ) : cameraState === 'blocked' ? (
            <div className="photo-camera-blocked">
              <Camera aria-hidden="true" size={34} />
              <strong>{cameraError}</strong>
            </div>
          ) : (
            <>
              <video ref={videoRef} autoPlay muted playsInline />
              {cameraState === 'starting' && <span>正在打开摄像头</span>}
            </>
          )}
        </div>

        <div className="photo-action-row">
          {cameraState === 'ready' ? (
            <button className="primary-button" type="button" onClick={capturePhoto}>
              <Camera aria-hidden="true" size={18} />
              拍照
            </button>
          ) : (
            <button
              className="primary-button"
              type="button"
              onClick={() => void startCamera()}
              disabled={cameraState === 'starting'}
            >
              <Camera aria-hidden="true" size={18} />
              {cameraState === 'starting' ? '打开中' : '打开摄像头'}
            </button>
          )}
          <button className="ghost-button" type="button" onClick={onDeclinePhoto}>
            <ImageOff aria-hidden="true" size={18} />
            不愿意拍照
          </button>
        </div>
      </aside>
    </div>
  )
}

type JobHopPanelProps = {
  bosses: Boss[]
  currentBossId: BossId
  secondaryBossId: BossId | null
  onClose: () => void
  onConfirmBoss: (boss: Boss) => void
  onPreviewVoice: (boss: Boss) => void
}

const JobHopPanel = ({
  bosses,
  currentBossId,
  secondaryBossId,
  onClose,
  onConfirmBoss,
  onPreviewVoice,
}: JobHopPanelProps) => {
  const [dongGiftOpen, setDongGiftOpen] = useState(false)

  const previewBoss = (boss: Boss) => {
    onPreviewVoice(boss)
    if (boss.id === 'dongming') {
      setDongGiftOpen(true)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <aside
        aria-labelledby="job-hop-title"
        aria-modal="true"
        className="job-hop-panel pixel-panel"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">跳槽</p>
            <h2 id="job-hop-title">选择公司/老板</h2>
          </div>
          <button aria-label="关闭跳槽面板" className="icon-button" type="button" onClick={onClose}>
            <X aria-hidden="true" size={22} />
          </button>
        </div>
        <div className="job-hop-list">
          {bosses.map((boss) => {
            const isMainBoss = boss.id === currentBossId
            const isSecondaryBoss = boss.id === secondaryBossId
            const articleClassName = [
              'unlocked',
              isMainBoss ? 'main-confirmed' : '',
              isSecondaryBoss ? 'secondary-confirmed' : '',
            ]
              .filter(Boolean)
              .join(' ')

            return (
              <article className={articleClassName} key={boss.id}>
                <button className="boss-preview-button" type="button" onClick={() => previewBoss(boss)}>
                  <div className="boss-portrait-frame">
                    <img src={boss.portraitSrc} alt={`${boss.company}-${boss.name}长方形像素图`} />
                    <div className="boss-portrait-copy">
                      <strong>{boss.company} · {boss.name}</strong>
                    </div>
                  </div>
                  <em>{boss.id === 'dongming' ? '点我有彩蛋' : '点击试听音效'}</em>
                </button>
                <button
                  className={
                    isMainBoss || isSecondaryBoss ? 'confirm-boss-button active' : 'confirm-boss-button'
                  }
                  type="button"
                  onClick={() => onConfirmBoss(boss)}
                >
                  {isMainBoss ? '主对话·已确认' : isSecondaryBoss ? '副对话·已确认' : '设为副对话'}
                </button>
              </article>
            )
          })}
        </div>
      </aside>

      {dongGiftOpen && (
        <aside
          aria-labelledby="dong-easter-title"
          aria-modal="true"
          className="dong-easter-egg"
          role="dialog"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            aria-label="关闭董小姐彩蛋"
            className="icon-button"
            type="button"
            onClick={() => setDongGiftOpen(false)}
          >
            <X aria-hidden="true" size={20} />
          </button>
          <img src="/easter-eggs/gree-phone.jpeg" alt="格力手机" />
          <div>
            <h2 id="dong-easter-title">感谢您选择董小姐</h2>
            <strong>送您一台超级手机。</strong>
          </div>
        </aside>
      )}
    </div>
  )
}

type OnboardingPanelProps = {
  okrs: OkrItem[]
  profile: Profile
  setProfile: (updater: Profile | ((previous: Profile) => Profile)) => void
  setOkrs: (updater: OkrItem[] | ((previous: OkrItem[]) => OkrItem[])) => void
  onComplete: (event?: FormEvent<HTMLFormElement>) => void
}

const OnboardingPanel = ({
  okrs,
  profile,
  setProfile,
  setOkrs,
  onComplete,
}: OnboardingPanelProps) => {
  const currentKpi = okrs[0] ?? INITIAL_OKRS[0]
  const keyResultsText = currentKpi.keyResults.join('\n')
  const boss = getBoss('ma')
  const updatePrimaryKpi = (updates: Partial<OkrItem>) => {
    setOkrs((previous) => {
      const first = previous[0] ?? INITIAL_OKRS[0]
      return [{ ...first, ...updates }, ...previous.slice(1)]
    })
  }

  return (
    <div className="onboarding-backdrop">
      <form
        aria-labelledby="onboarding-title"
        aria-modal="true"
        className="onboarding-card pixel-panel kpi-onboarding-card"
        role="dialog"
        onSubmit={onComplete}
      >
        <div className="onboarding-title-row">
          <BossAvatar boss={boss} />
          <div>
            <p className="eyebrow">KPI 设定</p>
            <h2 id="onboarding-title">先定 KPI，再接受拷打</h2>
          </div>
        </div>

        <label className="field-label">
          你的称呼
          <input
            value={profile.userName}
            onChange={(event) =>
              setProfile((previous) => ({ ...previous, userName: event.target.value }))
            }
          />
        </label>

        <label className="field-label">
          当前 KPI
          <input
            value={currentKpi.objective}
            onChange={(event) => {
              const objective = event.target.value
              setProfile((previous) => ({ ...previous, targetRole: objective }))
              updatePrimaryKpi({ objective })
            }}
          />
        </label>

        <label className="field-label compact-textarea-label">
          验收项
          <textarea
            value={keyResultsText}
            onChange={(event) => {
              const keyResults = event.target.value
                .split('\n')
                .map((item) => item.trim())
                .filter(Boolean)
                .slice(0, 4)
              updatePrimaryKpi({
                keyResults: keyResults.length ? keyResults : currentKpi.keyResults,
              })
            }}
          />
        </label>

        <div className="onboarding-okr interrogation-card">
          <AliValuesCard compact />
          <div>
            <span>阿里价值观拷打预告</span>
            <strong>{currentKpi.pressurePoint}</strong>
          </div>
        </div>

        <button className="primary-button full-width" type="submit">
          <Crown aria-hidden="true" size={20} />
          开始 KPI 拷打
        </button>
      </form>
    </div>
  )
}

type BottomTabsProps = {
  activeTab: TabId
  reportsCount: number
  onChange: (tab: TabId) => void
}

const BottomTabs = ({ activeTab, reportsCount, onChange }: BottomTabsProps) => (
  <nav className="bottom-tabs" aria-label="主导航">
    {tabs.map((tab) => {
      const Icon = tab.icon
      const active = tab.id === activeTab
      const showBadge = tab.id === 'group' && reportsCount > 0
      return (
        <button
          className={active ? 'active' : ''}
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
        >
          <Icon aria-hidden="true" size={24} />
          <span>{tab.label}</span>
          {showBadge && <em>{reportsCount}</em>}
        </button>
      )
    })}
  </nav>
)

type BossAvatarProps = {
  boss: Boss
}

const AliValuesCard = ({ compact = false }: { compact?: boolean }) => (
  <div className={compact ? 'ali-values-card compact' : 'ali-values-card'} aria-label="阿里巴巴价值观">
    {ALI_VALUES.map((value) => (
      <span key={value}>{value}</span>
    ))}
  </div>
)

const BossAvatar = ({ boss }: BossAvatarProps) => (
  <div className={`boss-avatar boss-avatar-${boss.id}`} aria-label={boss.name}>
    <img alt="" aria-hidden="true" src={boss.portraitSrc} />
  </div>
)

type ChatAvatarProps = {
  avatarUrl: string
  boss: Boss
  nickname: string
  useBossFallback?: boolean
}

const ChatAvatar = ({ avatarUrl, boss, nickname, useBossFallback = false }: ChatAvatarProps) =>
  avatarUrl ? (
    <div className="boss-avatar chat-photo-avatar" aria-label={nickname}>
      <img alt="" aria-hidden="true" src={avatarUrl} />
    </div>
  ) : useBossFallback ? (
    <BossAvatar boss={boss} />
  ) : (
    <div className="boss-avatar chat-initial-avatar" aria-label={nickname}>
      <span aria-hidden="true">{nickname.slice(0, 1) || '同'}</span>
    </div>
  )

type BossCutInProps = {
  boss: Boss
  scene: Scene
}

const BossCutIn = ({ boss, scene }: BossCutInProps) => (
  <aside className={boss.id === 'ma' ? 'boss-cutin' : 'boss-cutin secondary'} aria-live="polite">
    <BossAvatar boss={boss} />
    <div>
      <p>{boss.company} · {boss.name} · {boss.title}</p>
      <strong>{scene.shortLabel}？立刻解释</strong>
      <span>{boss.habit}</span>
    </div>
  </aside>
)

type MetricTileProps = {
  icon: LucideIcon
  label: string
  value: string
  suffix: string
}

const MetricTile = ({ icon: Icon, label, value, suffix }: MetricTileProps) => (
  <div className="metric-tile">
    <Icon aria-hidden="true" size={20} />
    <span>{label}</span>
    <strong>
      {value}
      <small>{suffix}</small>
    </strong>
  </div>
)

type MetricBarProps = {
  label: string
  value: number
}

const MetricBar = ({ label, value }: MetricBarProps) => (
  <div className="metric-bar">
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
    <span className="metric-track">
      <i style={{ width: `${value}%` }} />
    </span>
  </div>
)

export default App

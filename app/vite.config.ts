import { mkdir, writeFile } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import path from 'node:path'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const ROKID_API_ORIGIN = 'http://www.yhaox.top:18091'
const TOKENDANCE_IMAGE_API = 'https://tokendance.space/gateway/v1/images/generations'
const LOCAL_STATUS_PUBLIC_DIR = 'rokid-status'
const REPORT_POSTER_PUBLIC_DIR = 'generated-posters'
const USER_AVATAR_PUBLIC_DIR = 'user-avatars'
const CARTOON_AVATAR_PROMPT =
  '将上传图片中的人物转换为卡通像素风格头像或半身像，尽量保留人物的脸型、发型、五官、表情、姿态和整体辨识度；风格为可爱的 2D cartoon pixel art，清晰、干净、有游戏像素质感，不要过度马赛克，不要改变人物身份，不要添加文字、水印或无关人物。'

type RemoteStatusResponse = {
  ok?: boolean
  category?: string
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
}

const sanitizeSegment = (value: string) =>
  value.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_{2,}/g, '_').slice(0, 120) || 'capture'

const getExtensionFromContentType = (contentType: string | null) => {
  if (contentType?.includes('png')) return '.png'
  if (contentType?.includes('webp')) return '.webp'
  if (contentType?.includes('gif')) return '.gif'
  return '.jpg'
}

const getImageFileName = (
  category: string,
  status: RemoteStatusResponse,
  imageUrl: string,
  contentType: string | null,
) => {
  let sourceName = status.filename

  if (!sourceName) {
    try {
      const parsed = new URL(imageUrl)
      sourceName = parsed.searchParams.get('name') ?? path.basename(parsed.pathname)
    } catch {
      sourceName = ''
    }
  }

  const extension = getExtensionFromContentType(contentType)
  const safeBaseName = sanitizeSegment(sourceName || `status-${Date.now()}${extension}`)
  const baseNameWithExtension = path.extname(safeBaseName) ? safeBaseName : `${safeBaseName}${extension}`

  return `${sanitizeSegment(category)}-${baseNameWithExtension}`
}

const parseImageDataUrl = (imageDataUrl: string) => {
  const match = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/.exec(imageDataUrl)
  if (!match) return null
  const extension = match[1] === 'png' ? '.png' : match[1] === 'webp' ? '.webp' : '.jpg'
  return {
    buffer: Buffer.from(match[2], 'base64'),
    extension,
  }
}

const pickGeneratedImage = (payload: unknown): { b64Json?: string; url?: string } => {
  if (!payload || typeof payload !== 'object') return {}
  const record = payload as Record<string, unknown>
  const data = Array.isArray(record.data) ? record.data : []
  const firstData = data[0]
  if (firstData && typeof firstData === 'object') {
    const item = firstData as Record<string, unknown>
    if (typeof item.b64_json === 'string') return { b64Json: item.b64_json }
    if (typeof item.url === 'string') return { url: item.url }
  }

  if (typeof record.b64_json === 'string') return { b64Json: record.b64_json }
  if (typeof record.url === 'string') return { url: record.url }
  if (Array.isArray(record.image_urls) && typeof record.image_urls[0] === 'string') {
    return { url: record.image_urls[0] }
  }
  if (Array.isArray(record.images) && typeof record.images[0] === 'string') {
    return { url: record.images[0] }
  }

  return {}
}

const requestCartoonAvatar = async (imageDataUrl: string, apiKey: string) => {
  if (!apiKey) {
    throw new Error('TOKENDANCE_API_KEY 未配置，请在 .env 中设置（参见 .env.example）')
  }
  const basePayload = {
    model: 'seedream-5.0-lite',
    prompt: CARTOON_AVATAR_PROMPT,
    n: 1,
    size: '1024x1024',
    response_format: 'url',
  }
  const payloads = [
    { ...basePayload, input: { image_urls: [imageDataUrl] } },
    { ...basePayload, image: imageDataUrl },
    { ...basePayload, image_url: imageDataUrl },
  ]
  let lastError = ''

  for (const payload of payloads) {
    const generationResponse = await fetch(TOKENDANCE_IMAGE_API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    const responseText = await generationResponse.text()

    if (!generationResponse.ok) {
      lastError = `cartoon request failed: ${generationResponse.status} ${responseText.slice(0, 240)}`
      if (generationResponse.status >= 500) break
      continue
    }

    try {
      return JSON.parse(responseText) as unknown
    } catch {
      throw new Error('cartoon response is not json')
    }
  }

  throw new Error(lastError || 'cartoon request failed')
}

const readRequestBody = (request: IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    let body = ''

    request.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8')
      if (body.length > 8 * 1024 * 1024) {
        reject(new Error('request body too large'))
        request.destroy()
      }
    })

    request.on('end', () => resolve(body))
    request.on('error', reject)
  })

const rokidLocalStatusPlugin = (options: { tokendanceApiKey: string }): Plugin => ({
  name: 'rokid-local-status',
  configureServer(server) {
    server.middlewares.use('/local-api/status', async (request, response) => {
      if (request.method !== 'GET') {
        response.statusCode = 405
        response.setHeader('Allow', 'GET')
        response.end('Method Not Allowed')
        return
      }

      const requestUrl = new URL(request.url ?? '/', 'http://localhost')
      const category = requestUrl.searchParams.get('category')?.trim() || 'rokid'
      const remoteUrl = new URL('/client/status', ROKID_API_ORIGIN)
      remoteUrl.searchParams.set('category', category)

      try {
        const statusResponse = await fetch(remoteUrl)

        if (!statusResponse.ok) {
          response.statusCode = statusResponse.status
          response.setHeader('Content-Type', 'application/json; charset=utf-8')
          response.end(
            JSON.stringify({
              ok: false,
              category,
              error: `remote status request failed: ${statusResponse.status}`,
            }),
          )
          return
        }

        const status = (await statusResponse.json()) as RemoteStatusResponse
        let localImageUrl = ''
        let imageSavedAtIso = ''
        let localFilename = ''
        let imageDownloadError = ''

        if (status.imageUrl) {
          try {
            const imageResponse = await fetch(status.imageUrl)

            if (!imageResponse.ok) {
              throw new Error(`image request failed: ${imageResponse.status}`)
            }

            const contentType = imageResponse.headers.get('content-type')
            localFilename = getImageFileName(category, status, status.imageUrl, contentType)

            const publicDir = path.resolve(process.cwd(), 'public', LOCAL_STATUS_PUBLIC_DIR)
            await mkdir(publicDir, { recursive: true })
            await writeFile(
              path.join(publicDir, localFilename),
              Buffer.from(await imageResponse.arrayBuffer()),
            )

            localImageUrl = `/${LOCAL_STATUS_PUBLIC_DIR}/${encodeURIComponent(localFilename)}`
            imageSavedAtIso = new Date().toISOString()
          } catch (error) {
            imageDownloadError = error instanceof Error ? error.message : 'image download failed'
          }
        }

        response.statusCode = 200
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.setHeader('Cache-Control', 'no-store')
        response.end(
          JSON.stringify({
            ...status,
            category: status.category ?? category,
            localImageUrl,
            imageSavedAtIso,
            imageDownloadError,
            capture: localImageUrl
              ? {
                  id: `rokid-status-${category}-${localFilename}`,
                  filename: status.filename ?? localFilename,
                  localFilename,
                  url: localImageUrl,
                  category: status.category ?? category,
                  modifiedAt: imageSavedAtIso ? Date.parse(imageSavedAtIso) : Date.now(),
                  modifiedAtIso: imageSavedAtIso,
                }
              : null,
          }),
        )
      } catch (error) {
        response.statusCode = 502
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.end(
          JSON.stringify({
            ok: false,
            category,
            error: error instanceof Error ? error.message : 'status request failed',
          }),
        )
      }
    })

    server.middlewares.use('/local-api/report-poster', async (request, response) => {
      if (request.method !== 'POST') {
        response.statusCode = 405
        response.setHeader('Allow', 'POST')
        response.end('Method Not Allowed')
        return
      }

      try {
        const body = await readRequestBody(request)
        const payload = JSON.parse(body) as {
          imageDataUrl?: string
          filename?: string
        }
        const imageDataUrl = payload.imageDataUrl ?? ''
        const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(imageDataUrl)

        if (!match) {
          response.statusCode = 400
          response.setHeader('Content-Type', 'application/json; charset=utf-8')
          response.end(JSON.stringify({ ok: false, error: 'invalid png data url' }))
          return
        }

        const safeBaseName = sanitizeSegment(
          payload.filename || `department-poster-${Date.now()}.png`,
        )
        const filename = path.extname(safeBaseName) === '.png' ? safeBaseName : `${safeBaseName}.png`
        const publicDir = path.resolve(process.cwd(), 'public', REPORT_POSTER_PUBLIC_DIR)
        await mkdir(publicDir, { recursive: true })
        await writeFile(path.join(publicDir, filename), Buffer.from(match[1], 'base64'))

        response.statusCode = 200
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.setHeader('Cache-Control', 'no-store')
        response.end(
          JSON.stringify({
            ok: true,
            filename,
            url: `/${REPORT_POSTER_PUBLIC_DIR}/${encodeURIComponent(filename)}`,
            savedAtIso: new Date().toISOString(),
          }),
        )
      } catch (error) {
        response.statusCode = 500
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.end(
          JSON.stringify({
            ok: false,
            error: error instanceof Error ? error.message : 'poster save failed',
          }),
        )
      }
    })

    server.middlewares.use('/local-api/cartoon-avatar', async (request, response) => {
      if (request.method !== 'POST') {
        response.statusCode = 405
        response.setHeader('Allow', 'POST')
        response.end('Method Not Allowed')
        return
      }

      try {
        const body = await readRequestBody(request)
        const payload = JSON.parse(body) as {
          imageDataUrl?: string
        }
        const imageDataUrl = payload.imageDataUrl ?? ''
        const inputImage = parseImageDataUrl(imageDataUrl)

        if (!inputImage) {
          response.statusCode = 400
          response.setHeader('Content-Type', 'application/json; charset=utf-8')
          response.end(JSON.stringify({ ok: false, error: 'invalid image data url' }))
          return
        }

        const generationPayload = await requestCartoonAvatar(imageDataUrl, options.tokendanceApiKey)
        const generated = pickGeneratedImage(generationPayload)
        let outputBuffer: Buffer
        let extension = '.png'
        let sourceUrl = ''

        if (generated.b64Json) {
          outputBuffer = Buffer.from(generated.b64Json, 'base64')
        } else if (generated.url) {
          sourceUrl = generated.url
          const imageResponse = await fetch(generated.url)
          if (!imageResponse.ok) {
            throw new Error(`generated image download failed: ${imageResponse.status}`)
          }
          extension = getExtensionFromContentType(imageResponse.headers.get('content-type'))
          outputBuffer = Buffer.from(await imageResponse.arrayBuffer())
        } else {
          throw new Error('cartoon response missing image')
        }

        const filename = `user-avatar-${Date.now()}${extension}`
        const publicDir = path.resolve(process.cwd(), 'public', USER_AVATAR_PUBLIC_DIR)
        await mkdir(publicDir, { recursive: true })
        await writeFile(path.join(publicDir, filename), outputBuffer)

        response.statusCode = 200
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.setHeader('Cache-Control', 'no-store')
        response.end(
          JSON.stringify({
            ok: true,
            filename,
            url: `/${USER_AVATAR_PUBLIC_DIR}/${encodeURIComponent(filename)}`,
            sourceUrl,
            savedAtIso: new Date().toISOString(),
          }),
        )
      } catch (error) {
        response.statusCode = 502
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.end(
          JSON.stringify({
            ok: false,
            error: error instanceof Error ? error.message : 'cartoon avatar failed',
          }),
        )
      }
    })
  },
})

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // 从 .env / 进程环境读取密钥（参见 .env.example）；不再在源码中硬编码
  const env = loadEnv(mode, process.cwd(), '')
  const tokendanceApiKey = env.TOKENDANCE_API_KEY ?? process.env.TOKENDANCE_API_KEY ?? ''

  return {
    plugins: [rokidLocalStatusPlugin({ tokendanceApiKey }), react()],
    server: {
      proxy: {
        '/api': {
          target: ROKID_API_ORIGIN,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
  }
})

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { getFFmpeg } from '../lib/ffmpeg'
import type { GeneratedAsset } from '../types'
import { formatBytes, generateId } from '../utils/format'
import { computeFFmpegMD5 } from '../utils/hash'

type ViewMode = 'card' | 'list' | 'table'

type VideoConfig = {
  width: number
  height: number
  duration: number
  fps: number
  startColor: string
  text: string
  randomizeHash: boolean
  withAudio: boolean
}

const props = defineProps<{
  maxHistory: number
}>()

const emit = defineEmits<{
  (e: 'preview', asset: GeneratedAsset): void
  (e: 'toast', payload: { message: string; type: 'success' | 'error' }): void
  (e: 'status', message: string): void
}>()

const videoConfig = reactive<VideoConfig>({
  width: 640,
  height: 360,
  duration: 4,
  fps: 24,
  startColor: '#0ea5e9',
  text: '测试视频',
  randomizeHash: false,
  withAudio: false,
})

const viewOptions: { value: ViewMode; label: string }[] = [
  { value: 'card', label: '卡片' },
  { value: 'list', label: '列表' },
  { value: 'table', label: '表格' },
]

const viewMode = ref<ViewMode>('card')
const isVideoGenerating = ref(false)
const videoResults = ref<GeneratedAsset[]>([])

const cleanupAsset = (asset?: GeneratedAsset) => {
  if (asset?.url) URL.revokeObjectURL(asset.url)
}

const pushResult = (asset: GeneratedAsset) => {
  videoResults.value = [asset, ...videoResults.value]
  if (videoResults.value.length > props.maxHistory) {
    const removed = videoResults.value.pop()
    cleanupAsset(removed)
  }
}

const normalizeHex = (value: string) => {
  let hex = value.trim()
  if (hex.startsWith('#')) hex = hex.slice(1)
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('')
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    return '222222'
  }
  return hex.toLowerCase()
}

const toFFmpegColor = (value: string) => `0x${normalizeHex(value)}`

const nudgedColor = (value: string) => {
  const hex = normalizeHex(value)
  const num = parseInt(hex, 16)
  const delta = Math.floor(Math.random() * 50) - 25
  const r = Math.max(0, Math.min(255, ((num >> 16) & 255) + delta))
  const g = Math.max(0, Math.min(255, ((num >> 8) & 255) + delta))
  const b = Math.max(0, Math.min(255, (num & 255) + delta))
  return `0x${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

const canPreview = (asset: GeneratedAsset) => asset.status === 'ready'
const canDownload = (asset: GeneratedAsset) => asset.status === 'ready' && Boolean(asset.url)

const assetStatusText = (asset: GeneratedAsset) => {
  if (asset.status === 'pending') return '生成中'
  if (asset.status === 'error') return '生成失败'
  return '可用'
}

const assetStatusClass = (asset: GeneratedAsset) => {
  if (asset.status === 'pending') return 'badge badge-pending'
  if (asset.status === 'error') return 'badge badge-error'
  return 'badge badge-ready'
}

const generateVideo = async () => {
  if (videoConfig.width <= 0 || videoConfig.height <= 0 || videoConfig.duration <= 0 || videoConfig.fps <= 0) {
    emit('toast', { type: 'error', message: '请确保宽度/高度/时长/FPS 都大于 0' })
    return
  }
  if (isVideoGenerating.value) return
  isVideoGenerating.value = true
  emit('status', '正在加载 FFmpeg…')
  const width = Math.max(1, Math.floor(videoConfig.width))
  const height = Math.max(1, Math.floor(videoConfig.height))
  const durationSeconds = Math.max(0.1, Number(videoConfig.duration))
  const fps = Math.max(1, Math.floor(videoConfig.fps))
  const placeholder: GeneratedAsset = {
    id: generateId(),
    kind: 'video',
    url: '',
    mime: 'video/mp4',
    name: `${videoConfig.text || 'video'}-${width}x${height}.mp4`,
    detail: `${width} × ${height}px · ${durationSeconds.toFixed(2)}s`,
    size: 0,
    sizeLabel: '生成中',
    createdAt: Date.now(),
    status: 'pending',
    progress: 0,
  }
  pushResult(placeholder)
  const startedAt = performance.now()
  let ffmpegInstance: Awaited<ReturnType<typeof getFFmpeg>> | null = null
  const handleProgress = ({ time }: { progress: number; time: number }) => {
    emit('status', `编码中，已处理 ${time.toFixed(1)} 秒`)
  }
  try {
    ffmpegInstance = await getFFmpeg()
    ffmpegInstance.on('progress', handleProgress)
    const baseColor = videoConfig.randomizeHash ? nudgedColor(videoConfig.startColor) : toFFmpegColor(videoConfig.startColor)
    const metadataArgs = videoConfig.randomizeHash ? ['-metadata', `seed=${generateId()}`] : []
    const outputName = `video_${Date.now()}.mp4`
    const withAudio = videoConfig.withAudio
    const audioInputArgs = withAudio
      ? [
          '-f',
          'lavfi',
          '-i',
          `sine=frequency=440:duration=${durationSeconds}:sample_rate=44100`,
        ]
      : []
    const mapArgs = withAudio ? ['-map', '0:v:0', '-map', '1:a:0'] : []
    const audioCodecArgs = withAudio ? ['-c:a', 'aac', '-b:a', '128k'] : []
    emit('status', 'FFmpeg 正在生成视频…')
    await ffmpegInstance.exec([
      '-f',
      'lavfi',
      '-i',
      `color=c=${baseColor}:s=${width}x${height}:d=${durationSeconds}:r=${fps}`,
      ...audioInputArgs,
      ...mapArgs,
      '-vf',
      'format=yuv420p',
      '-movflags',
      'faststart',
      '-preset',
      'ultrafast',
      '-c:v',
      'libx264',
      ...audioCodecArgs,
      '-pix_fmt',
      'yuv420p',
      ...metadataArgs,
      '-shortest',
      '-y',
      outputName,
    ])
    const data = (await ffmpegInstance.readFile(outputName)) as Uint8Array
    const videoBinary = new Uint8Array(data)
    const videoBuffer = videoBinary.buffer.slice(videoBinary.byteOffset, videoBinary.byteOffset + videoBinary.byteLength)
    const blob = new Blob([videoBuffer], { type: 'video/mp4' })
    const hash = await computeFFmpegMD5(blob)
    placeholder.url = URL.createObjectURL(blob)
    placeholder.size = blob.size
    placeholder.sizeLabel = formatBytes(blob.size)
    placeholder.status = 'ready'
    placeholder.progress = 1
    placeholder.hash = hash
    emit('status', `视频生成完成 (${placeholder.sizeLabel}) · 用时 ${((performance.now() - startedAt) / 1000).toFixed(1)} 秒`)
    emit('toast', { type: 'success', message: '视频生成完成' })
    try {
      await ffmpegInstance.deleteFile(outputName)
    } catch (cleanupError) {
      console.warn('清理生成文件失败', cleanupError)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '视频生成失败'
    emit('status', message)
    placeholder.status = 'error'
    placeholder.sizeLabel = '生成失败'
    placeholder.detail = message
    emit('toast', { type: 'error', message })
  } finally {
    if (ffmpegInstance) {
      ffmpegInstance.off('progress', handleProgress)
    }
    isVideoGenerating.value = false
  }
}

const downloadAsset = (asset: GeneratedAsset) => {
  if (!asset.url) return
  const link = document.createElement('a')
  link.href = asset.url
  link.download = asset.name
  document.body.append(link)
  link.click()
  link.remove()
}

const removeAsset = (assetId: string) => {
  const asset = videoResults.value.find((item) => item.id === assetId)
  if (!asset || asset.status === 'pending') return
  cleanupAsset(asset)
  videoResults.value = videoResults.value.filter((item) => item.id !== assetId)
  emit('toast', { type: 'success', message: '已删除视频资源' })
}
</script>

<template>
  <div class="generator-stack">
    <article class="panel">
    <header>
      <h2>视频配置</h2>
      <p>使用 FFmpeg.wasm 直接生成纯色测试视频，支持任意时长。</p>
    </header>
    <form class="form-grid" @submit.prevent="generateVideo">
      <label>
        宽度(px)
        <input v-model.number="videoConfig.width" min="1" step="1" type="number" required />
      </label>
      <label>
        高度(px)
        <input v-model.number="videoConfig.height" min="1" step="1" type="number" required />
      </label>
      <label>
        时长(秒)
        <input v-model.number="videoConfig.duration" min="0.1" step="0.1" type="number" required />
      </label>
      <label>
        FPS
        <input v-model.number="videoConfig.fps" min="12" max="60" type="number" required />
      </label>
      <label>
        背景颜色
        <input v-model="videoConfig.startColor" type="color" />
      </label>
      <label>
        视频标识
        <input v-model="videoConfig.text" placeholder="用于文件命名" />
      </label>
      <label>
        哈希扰动
        <select v-model="videoConfig.randomizeHash">
          <option :value="false">关闭</option>
          <option :value="true">开启</option>
        </select>
      </label>
      <label>
        包含音频
        <select v-model="videoConfig.withAudio">
          <option :value="false">关闭</option>
          <option :value="true">开启</option>
        </select>
      </label>
      <button class="primary" :disabled="isVideoGenerating" type="submit">
        {{ isVideoGenerating ? '生成中…' : '生成视频' }}
      </button>
    </form>
  </article>

    <section class="results-block">
    <div class="section-header">
      <div class="section-title">
        <h3>视频结果</h3>
        <p>保留最近 {{ maxHistory }} 条</p>
      </div>
      <div class="view-switch">
        <button
          v-for="option in viewOptions"
          :key="option.value"
          type="button"
          :class="{ active: viewMode === option.value }"
          @click="viewMode = option.value"
        >
          {{ option.label }}
        </button>
      </div>
    </div>
    <template v-if="videoResults.length">
      <div class="result-grid" v-if="viewMode === 'card'">
        <article
          class="asset-card"
          v-for="asset in videoResults"
          :key="asset.id"
          :class="{ 'asset-card--disabled': asset.status !== 'ready' }"
          @click="asset.status === 'ready' && emit('preview', asset)"
        >
          <template v-if="asset.url && asset.status === 'ready'">
            <video :src="asset.url" controls preload="metadata"></video>
          </template>
          <div v-else class="video-placeholder">视频尚未生成</div>
            <div class="asset-meta">
              <strong>{{ asset.name }}</strong>
              <span>{{ asset.detail }}</span>
              <span>{{ asset.sizeLabel }}</span>
              <span v-if="asset.hash" class="asset-hash">MD5: {{ asset.hash }}</span>
            </div>
          <div class="asset-actions">
            <button :disabled="asset.status !== 'ready'" type="button" @click.stop="downloadAsset(asset)">
              下载
            </button>
            <button
              type="button"
              class="ghost-button"
              :disabled="asset.status === 'pending'"
              @click.stop="removeAsset(asset.id)"
            >
              删除
            </button>
          </div>
          <div
            v-if="asset.status === 'pending' || asset.status === 'error'"
            class="asset-overlay"
            :class="{ error: asset.status === 'error' }"
          >
            <template v-if="asset.status === 'pending'">
              <div class="overlay-spinner"></div>
              <p class="asset-overlay-title">生成中</p>
            </template>
            <template v-else>
              <p class="asset-overlay-title">生成失败</p>
              <p class="asset-overlay-desc">{{ asset.detail }}</p>
            </template>
          </div>
        </article>
      </div>
      <div class="result-list" v-else-if="viewMode === 'list'">
        <article class="list-item" v-for="asset in videoResults" :key="asset.id">
          <div class="list-preview">
            <template v-if="asset.url && asset.status === 'ready'">
              <video :src="asset.url" muted preload="metadata"></video>
            </template>
            <div v-else class="video-placeholder">视频尚未生成</div>
          </div>
            <div class="list-content">
              <strong>{{ asset.name }}</strong>
              <span>{{ asset.detail }}</span>
              <span>{{ asset.sizeLabel }}</span>
              <span v-if="asset.hash" class="asset-hash">MD5: {{ asset.hash }}</span>
            </div>
          <div class="list-status">
            <span :class="assetStatusClass(asset)">{{ assetStatusText(asset) }}</span>
          </div>
          <div class="list-actions">
            <button type="button" :disabled="!canPreview(asset)" @click="canPreview(asset) && emit('preview', asset)">预览</button>
            <button
              type="button"
              :disabled="!canDownload(asset)"
              @click="canDownload(asset) && downloadAsset(asset)"
            >
              下载
            </button>
            <button
              type="button"
              class="ghost-button"
              :disabled="asset.status === 'pending'"
              @click="removeAsset(asset.id)"
            >
              删除
            </button>
          </div>
        </article>
      </div>
      <div class="table-wrapper" v-else>
          <table class="result-table">
            <thead>
              <tr>
                <th>预览</th>
                <th>名称</th>
                <th>详情</th>
                <th>大小</th>
                <th>哈希</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
          <tbody>
            <tr v-for="asset in videoResults" :key="asset.id">
              <td>
                <div class="table-thumb">
                  <template v-if="asset.url && asset.status === 'ready'">
                    <video :src="asset.url" muted preload="metadata"></video>
                  </template>
                  <div v-else class="video-placeholder">-</div>
                </div>
              </td>
                  <td class="table-name">{{ asset.name }}</td>
              <td>{{ asset.detail }}</td>
              <td>{{ asset.sizeLabel }}</td>
              <td>{{ asset.hash || '-' }}</td>
              <td>
                <span :class="assetStatusClass(asset)">{{ assetStatusText(asset) }}</span>
              </td>
                  <td>
                    <div class="table-actions">
                      <button
                        type="button"
                        :disabled="!canPreview(asset)"
                        @click="canPreview(asset) && emit('preview', asset)"
                      >
                        预览
                      </button>
                      <button
                        type="button"
                        :disabled="!canDownload(asset)"
                        @click="canDownload(asset) && downloadAsset(asset)"
                      >
                        下载
                      </button>
                      <button
                        type="button"
                        class="ghost-button"
                        :disabled="asset.status === 'pending'"
                        @click="removeAsset(asset.id)"
                      >
                        删除
                      </button>
                    </div>
                  </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
    <p v-else class="placeholder">还没有生成视频，配置参数后点击生成即可。</p>
  </section>
  </div>
</template>

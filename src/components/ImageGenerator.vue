<script setup lang="ts">
import { reactive, ref } from 'vue'
import type { GeneratedAsset } from '../types'
import { formatBytes, generateId, computeHash } from '../utils/format'

type ViewMode = 'card' | 'list' | 'table'
type GenerationMode = 'single' | 'batch'

type ImageConfig = {
  width: number
  height: number
  background: string
  text: string
  textColor: string
  textSize: number
  showGrid: boolean
  format: 'image/png' | 'image/jpeg'
  randomizeHash: boolean
}

const props = defineProps<{
  maxHistory: number
}>()

const emit = defineEmits<{
  (e: 'preview', asset: GeneratedAsset): void
  (e: 'toast', payload: { message: string; type: 'success' | 'error' }): void
  (e: 'status', message: string): void
}>()

const randomHexColor = () => {
  const random = Math.floor(Math.random() * 0xffffff)
  return `#${random.toString(16).padStart(6, '0')}`
}

const imageConfig = reactive<ImageConfig>({
  width: 1280,
  height: 720,
  background: randomHexColor(),
  text: '测试图片',
  textColor: '#f8fafc',
  textSize: 96,
  showGrid: true,
  format: 'image/png',
  randomizeHash: false,
})

const isImageGenerating = ref(false)
const imageResults = ref<GeneratedAsset[]>([])
const viewMode = ref<ViewMode>('card')
const generationMode = ref<GenerationMode>('single')
const batchCount = ref(3)
const viewOptions: { value: ViewMode; label: string }[] = [
  { value: 'card', label: '卡片' },
  { value: 'list', label: '列表' },
  { value: 'table', label: '表格' },
]

const cleanupAsset = (asset?: GeneratedAsset) => {
  if (asset?.url) {
    URL.revokeObjectURL(asset.url)
  }
}

const pushResult = (asset: GeneratedAsset) => {
  imageResults.value = [asset, ...imageResults.value]
  if (imageResults.value.length > props.maxHistory) {
    const removed = imageResults.value.pop()
    cleanupAsset(removed)
  }
}

const drawGrid = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
  ctx.save()
  ctx.strokeStyle = 'rgba(255,255,255,0.15)'
  ctx.lineWidth = 1
  const step = 80
  for (let x = step; x < width; x += step) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, height)
    ctx.stroke()
  }
  for (let y = step; y < height; y += step) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(width, y)
    ctx.stroke()
  }
  ctx.restore()
}

const drawImagePlaceholder = (canvas: HTMLCanvasElement, config: ImageConfig) => {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法获取画布上下文')
  ctx.fillStyle = config.background
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  if (config.showGrid) {
    drawGrid(ctx, canvas.width, canvas.height)
  }
  const subSize = Math.max(Math.round(config.textSize / 3), 18)
  ctx.fillStyle = config.textColor
  ctx.font = `700 ${config.textSize}px 'JetBrains Mono', 'Menlo', 'Segoe UI', sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = 'rgba(2,6,23,0.85)'
  ctx.shadowBlur = 20
  const title = config.text || `${config.width}×${config.height}`
  const centerY = canvas.height / 2 - subSize * 0.15
  ctx.strokeStyle = 'rgba(2,6,23,0.95)'
  ctx.lineWidth = Math.max(4, Math.round(config.textSize * 0.1))
  ctx.strokeText(title, canvas.width / 2, centerY)
  ctx.fillText(title, canvas.width / 2, centerY)
  ctx.shadowBlur = 6
  ctx.font = `600 ${subSize}px 'JetBrains Mono', 'Menlo', sans-serif`
  const subtitleY = centerY + config.textSize * 0.9 + Math.max(subSize * 0.25, 8)
  const subtitle = `${config.width} × ${config.height}px`
  ctx.strokeStyle = 'rgba(2,6,23,0.9)'
  ctx.lineWidth = Math.max(3, Math.round(config.textSize * 0.04))
  ctx.strokeText(subtitle, canvas.width / 2, subtitleY)
  ctx.fillText(subtitle, canvas.width / 2, subtitleY)
  ctx.shadowBlur = 0
}

const addHashNoise = (ctx: CanvasRenderingContext2D) => {
  const x = Math.random() * ctx.canvas.width
  const y = Math.random() * ctx.canvas.height
  ctx.save()
  ctx.fillStyle = `rgba(${Math.floor(Math.random() * 255)}, ${Math.floor(Math.random() * 255)}, ${Math.floor(
    Math.random() * 255,
  )}, 0.02)`
  ctx.fillRect(x, y, 1, 1)
  ctx.restore()
}

const canvasToBlob = (canvas: HTMLCanvasElement, mime: string) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('生成失败，请重试'))
          return
        }
        resolve(blob)
      },
      mime,
      mime === 'image/jpeg' ? 0.92 : undefined,
    )
  })

const generateImage = async () => {
  if (isImageGenerating.value) return
  isImageGenerating.value = true
  emit('status', generationMode.value === 'batch' ? '批量生成图片…' : '正在生成图片…')
  try {
    const tasks = generationMode.value === 'batch' ? Math.max(1, Math.floor(batchCount.value)) : 1
    for (let i = 0; i < tasks; i++) {
      const canvas = document.createElement('canvas')
      canvas.width = imageConfig.width
      canvas.height = imageConfig.height
      const config = { ...imageConfig }
      if (generationMode.value === 'batch') {
        config.background = randomHexColor()
        config.textColor = '#ffffff'
      }
      drawImagePlaceholder(canvas, config)
      if (config.randomizeHash) {
        const ctx = canvas.getContext('2d')
        if (ctx) addHashNoise(ctx)
      }
      const blob = await canvasToBlob(canvas, config.format)
      const hash = await computeHash(blob)
      const asset: GeneratedAsset = {
        id: generateId(),
        kind: 'image',
        url: URL.createObjectURL(blob),
        mime: config.format,
        name: `${config.text || 'image'}-${config.width}x${config.height}.${config.format === 'image/png' ? 'png' : 'jpg'}`,
        detail: `${config.width} × ${config.height}px`,
        size: blob.size,
        sizeLabel: formatBytes(blob.size),
        createdAt: Date.now(),
        status: 'ready',
        hash,
      }
      pushResult(asset)
    }
    emit('status', generationMode.value === 'batch' ? `批量生成完成 (${tasks} 张)` : '图片生成完成')
    emit('toast', { type: 'success', message: generationMode.value === 'batch' ? '批量图片生成完成' : '图片生成完成' })
  } catch (error) {
    const message = error instanceof Error ? error.message : '图片生成失败'
    emit('status', message)
    emit('toast', { type: 'error', message })
  } finally {
    isImageGenerating.value = false
  }
}

const removeAsset = (assetId: string) => {
  const asset = imageResults.value.find((item) => item.id === assetId)
  if (!asset) return
  cleanupAsset(asset)
  imageResults.value = imageResults.value.filter((item) => item.id !== assetId)
  emit('toast', { type: 'success', message: '已删除图片资源' })
}

const downloadAsset = (asset: GeneratedAsset) => {
  const link = document.createElement('a')
  link.href = asset.url
  link.download = asset.name
  document.body.append(link)
  link.click()
  link.remove()
}
</script>

<template>
  <div class="generator-stack">
    <article class="panel">
      <header>
        <h2>图片配置</h2>
        <p>生成 PNG 或 JPG 占位图，可选网格与文字。</p>
      </header>
      <form class="form-grid" @submit.prevent="generateImage">
        <label>
          宽度(px)
          <input v-model.number="imageConfig.width" min="1" step="1" type="number" required />
        </label>
        <label>
          高度(px)
          <input v-model.number="imageConfig.height" min="1" step="1" type="number" required />
        </label>
        <label>
          背景色
          <input v-model="imageConfig.background" type="color" />
        </label>
        <label>
          显示文字
          <input v-model="imageConfig.text" placeholder="默认显示尺寸" />
        </label>
        <label>
          文字颜色
          <input v-model="imageConfig.textColor" type="color" />
        </label>
        <label>
          文字大小(px)
          <input v-model.number="imageConfig.textSize" min="12" max="160" step="2" type="number" />
        </label>
        <label>
          输出格式
          <select v-model="imageConfig.format">
            <option value="image/png">PNG</option>
            <option value="image/jpeg">JPEG</option>
          </select>
        </label>
        <label>
          显示网格
          <select v-model="imageConfig.showGrid">
            <option :value="true">显示</option>
            <option :value="false">隐藏</option>
          </select>
        </label>
        <label>
          哈希扰动
          <select v-model="imageConfig.randomizeHash">
            <option :value="false">关闭</option>
            <option :value="true">开启</option>
          </select>
        </label>
        <label>
          生成模式
          <select v-model="generationMode">
            <option value="single">单张</option>
            <option value="batch">批量随机色</option>
          </select>
        </label>
        <label v-if="generationMode === 'batch'">
          批量数量
          <input v-model.number="batchCount" min="1" step="1" type="number" required />
        </label>
        <button class="primary" :disabled="isImageGenerating" type="submit">
          {{ isImageGenerating ? '生成中…' : '生成图片' }}
        </button>
      </form>
    </article>

    <section class="results-block">
      <div class="section-header">
        <div class="section-title">
          <h3>图片结果</h3>
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
      <template v-if="imageResults.length">
        <div class="result-grid" v-if="viewMode === 'card'">
          <article class="asset-card" v-for="asset in imageResults" :key="asset.id" @click="emit('preview', asset)">
            <img :src="asset.url" :alt="asset.name" loading="lazy" />
          <div class="asset-meta">
            <strong>{{ asset.name }}</strong>
            <span>{{ asset.detail }}</span>
            <span>{{ asset.sizeLabel }}</span>
          </div>
        <div class="asset-actions">
          <button type="button" @click.stop="downloadAsset(asset)">下载</button>
          <button type="button" class="ghost-button" @click.stop="removeAsset(asset.id)">删除</button>
        </div>
          </article>
        </div>
        <div class="result-list" v-else-if="viewMode === 'list'">
          <article class="list-item" v-for="asset in imageResults" :key="asset.id">
            <div class="list-preview">
              <img :src="asset.url" :alt="asset.name" loading="lazy" />
            </div>
            <div class="list-content">
              <strong>{{ asset.name }}</strong>
              <span>{{ asset.detail }}</span>
              <span>{{ asset.sizeLabel }}</span>
            </div>
            <div class="list-status">
              <span class="badge badge-ready">可用</span>
            </div>
          <div class="list-actions">
            <button type="button" @click="emit('preview', asset)">预览</button>
            <button type="button" @click="downloadAsset(asset)">下载</button>
            <button type="button" class="ghost-button" @click="removeAsset(asset.id)">删除</button>
          </div>
          </article>
        </div>
        <div class="table-wrapper" v-else>
          <table class="result-table">
            <thead>
            </thead>
            <tbody>
              <tr v-for="asset in imageResults" :key="asset.id">
                <td>
                  <div class="table-thumb">
                    <img :src="asset.url" :alt="asset.name" loading="lazy" />
                  </div>
                </td>
                <td>{{ asset.name }}</td>
                <td>{{ asset.detail }}</td>
                <td>{{ asset.sizeLabel }}</td>
                <td class="table-actions">
                <button type="button" @click="emit('preview', asset)">预览</button>
                <button type="button" @click="downloadAsset(asset)">下载</button>
                <button type="button" class="ghost-button" @click="removeAsset(asset.id)">删除</button>
              </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
      <p v-else class="placeholder">还没有生成图片，先试试上面的参数吧。</p>
    </section>
  </div>
</template>

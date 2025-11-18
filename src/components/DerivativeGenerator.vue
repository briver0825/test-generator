<script setup lang="ts">
import { computed, ref } from 'vue'
import { getFFmpeg } from '../lib/ffmpeg'
import type { GeneratedAsset } from '../types'
import { formatBytes, generateId } from '../utils/format'
import { computeFFmpegMD5 } from '../utils/hash'

const props = defineProps<{ maxHistory: number }>()

const emit = defineEmits<{
  (e: 'preview', asset: GeneratedAsset): void
  (e: 'toast', payload: { message: string; type: 'success' | 'error' }): void
  (e: 'status', message: string): void
}>()

const selectedFile = ref<File | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const randomizeHash = ref(true)
const isProcessing = ref(false)
const results = ref<GeneratedAsset[]>([])

type ViewMode = 'card' | 'list' | 'table'

const viewMode = ref<ViewMode>('card')
const viewOptions: { value: ViewMode; label: string }[] = [
  { value: 'card', label: '卡片' },
  { value: 'list', label: '列表' },
  { value: 'table', label: '表格' },
]

const selectedHash = ref<string>('')

const fileInfo = computed(() => {
  if (!selectedFile.value) return '未选择文件'
  const base = `${selectedFile.value.name} · ${formatBytes(selectedFile.value.size)}`
  return selectedHash.value ? `${base} · MD5: ${selectedHash.value}` : base
})

const cleanupAsset = (asset?: GeneratedAsset) => {
  if (asset?.url) URL.revokeObjectURL(asset.url)
}

const pushResult = (asset: GeneratedAsset) => {
  results.value = [asset, ...results.value]
  if (results.value.length > props.maxHistory) {
    const removed = results.value.pop()
    cleanupAsset(removed)
  }
}

const removeAsset = (id: string) => {
  const asset = results.value.find((item) => item.id === id)
  if (!asset) return
  cleanupAsset(asset)
  results.value = results.value.filter((item) => item.id !== id)
  emit('toast', { type: 'success', message: '已删除衍生素材' })
}

const onFileChange = async (event: Event) => {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0] ?? null
  selectedFile.value = file
  selectedHash.value = ''
  if (file) {
    try {
      selectedHash.value = await computeFFmpegMD5(file)
    } catch {
      selectedHash.value = ''
    }
  }
}

const clearFile = () => {
  selectedFile.value = null
  selectedHash.value = ''
  if (fileInput.value) fileInput.value.value = ''
}

const addNoisePixel = (ctx: CanvasRenderingContext2D) => {
  const x = Math.random() * ctx.canvas.width
  const y = Math.random() * ctx.canvas.height
  ctx.save()
  ctx.fillStyle = `rgba(${Math.floor(Math.random() * 255)}, ${Math.floor(Math.random() * 255)}, ${Math.floor(
    Math.random() * 255,
  )}, 0.02)`
  ctx.fillRect(x, y, 1, 1)
  ctx.restore()
}

const loadImageFromFile = (file: File) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('无法解析图片'))
    }
    img.src = url
  })

const deriveFromImage = async (file: File) => {
  const image = await loadImageFromFile(file)
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法获取画布')
  ctx.drawImage(image, 0, 0)
  if (randomizeHash.value) addNoisePixel(ctx)
  const format = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('生成失败'))), format, format === 'image/jpeg' ? 0.92 : undefined)
  })
  const hash = await computeFFmpegMD5(blob)
  return {
    blob,
    detail: `${image.width} × ${image.height}px`,
    mime: format,
    kind: 'image' as const,
    hash,
  }
}

const deriveFromVideo = async (file: File) => {
  const ffmpeg = await getFFmpeg()
  const inputName = `input-${Date.now()}-${Math.random().toString(36).slice(2)}.${file.name.split('.').pop() || 'mp4'}`
  const outputName = `derived-${Date.now()}.mp4`
  const data = new Uint8Array(await file.arrayBuffer())
  await ffmpeg.writeFile(inputName, data)
  const metadataArgs = randomizeHash.value ? ['-metadata', `derived=${generateId()}`] : []
  await ffmpeg.exec([
    '-i',
    inputName,
    '-c',
    'copy',
    '-movflags',
    'faststart',
    ...metadataArgs,
    '-y',
    outputName,
  ])
  const dataOut = (await ffmpeg.readFile(outputName)) as Uint8Array
  const videoBinary = new Uint8Array(dataOut)
  const videoBuffer = videoBinary.buffer.slice(
    videoBinary.byteOffset,
    videoBinary.byteOffset + videoBinary.byteLength,
  )
  const blob = new Blob([videoBuffer], { type: 'video/mp4' })
  const hash = await computeFFmpegMD5(blob)
  await ffmpeg.deleteFile(inputName).catch(() => undefined)
  await ffmpeg.deleteFile(outputName).catch(() => undefined)
  return {
    blob,
    detail: file.name,
    mime: 'video/mp4',
    kind: 'video' as const,
    hash,
  }
}

const deriveMaterial = async () => {
  if (!selectedFile.value) {
    emit('toast', { type: 'error', message: '请先选择素材文件' })
    return
  }
  const file = selectedFile.value
  const isImage = file.type.startsWith('image/')
  const isVideo = file.type.startsWith('video/')
  if (!isImage && !isVideo) {
    emit('toast', { type: 'error', message: '暂不支持该文件类型' })
    return
  }
  if (isProcessing.value) return
  isProcessing.value = true
  emit('status', '正在生成衍生素材…')
  try {
    const derived = isImage ? await deriveFromImage(file) : await deriveFromVideo(file)
    const ext = file.name.includes('.') ? `.${file.name.split('.').pop()}` : ''
    const asset: GeneratedAsset = {
      id: generateId(),
      kind: derived.kind,
      url: URL.createObjectURL(derived.blob),
      mime: derived.mime,
      name: `${file.name.replace(ext, '')}-derived${ext}`,
      detail: derived.detail,
      size: derived.blob.size,
      sizeLabel: formatBytes(derived.blob.size),
      createdAt: Date.now(),
      status: 'ready',
      hash: derived.hash,
    }
    pushResult(asset)
    emit('toast', { type: 'success', message: '素材衍生完成' })
    emit('status', '素材衍生完成')
  } catch (error) {
    const message = error instanceof Error ? error.message : '衍生失败'
    emit('status', message)
    emit('toast', { type: 'error', message })
  } finally {
    isProcessing.value = false
  }
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
        <h2>素材衍生</h2>
        <p>上传图片或视频，生成一个带有扰动的新版本。</p>
      </header>
      <div class="upload-area">
        <div class="form-grid upload-grid">
          <label class="file-input">
            素材文件
            <input ref="fileInput" type="file" accept="image/*,video/*" @change="onFileChange" />
          </label>
          <label>
            哈希扰动
            <select v-model="randomizeHash">
              <option :value="true">开启</option>
              <option :value="false">关闭</option>
            </select>
          </label>
          <label class="file-info full-span">
            当前素材
            <span>{{ fileInfo }}</span>
          </label>
        </div>
        <div class="upload-actions">
          <button type="button" class="ghost-button" @click="clearFile">清空</button>
          <button class="primary" type="button" :disabled="!selectedFile || isProcessing" @click="deriveMaterial">
            {{ isProcessing ? '生成中…' : '生成衍生素材' }}
          </button>
        </div>
      </div>
    </article>

    <section class="results-block">
      <div class="section-header">
        <div class="section-title">
          <h3>衍生结果</h3>
          <p>保留最近 {{ props.maxHistory }} 条</p>
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
      <template v-if="results.length">
        <div class="result-grid" v-if="viewMode === 'card'">
          <article class="asset-card" v-for="asset in results" :key="asset.id" @click="emit('preview', asset)">
            <template v-if="asset.kind === 'image'">
              <img :src="asset.url" :alt="asset.name" loading="lazy" />
            </template>
            <video v-else :src="asset.url" controls preload="metadata"></video>
            <div class="asset-meta">
              <strong>{{ asset.name }}</strong>
              <span>{{ asset.detail }}</span>
              <span>{{ asset.sizeLabel }}</span>
              <span v-if="asset.hash" class="asset-hash">MD5: {{ asset.hash }}</span>
            </div>
            <div class="asset-actions">
              <button type="button" @click.stop="downloadAsset(asset)">下载</button>
              <button type="button" class="ghost-button" @click.stop="removeAsset(asset.id)">删除</button>
            </div>
          </article>
        </div>

        <div class="result-list" v-else-if="viewMode === 'list'">
          <article class="list-item" v-for="asset in results" :key="asset.id">
            <div class="list-preview">
              <template v-if="asset.kind === 'image'">
                <img :src="asset.url" :alt="asset.name" loading="lazy" />
              </template>
              <video v-else :src="asset.url" muted preload="metadata"></video>
            </div>
            <div class="list-content">
              <strong>{{ asset.name }}</strong>
              <span>{{ asset.detail }}</span>
              <span>{{ asset.sizeLabel }}</span>
              <span v-if="asset.hash" class="asset-hash">MD5: {{ asset.hash }}</span>
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
              <tr>
                <th>预览</th>
                <th>名称</th>
                <th>详情</th>
                <th>大小</th>
                <th>哈希</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="asset in results" :key="asset.id">
                <td>
                  <div class="table-thumb">
                    <template v-if="asset.kind === 'image'">
                      <img :src="asset.url" :alt="asset.name" loading="lazy" />
                    </template>
                    <video v-else :src="asset.url" muted preload="metadata"></video>
                  </div>
                </td>
                <td class="table-name">{{ asset.name }}</td>
                <td>{{ asset.detail }}</td>
                <td>{{ asset.sizeLabel }}</td>
                <td>{{ asset.hash || '-' }}</td>
                <td>
                  <div class="table-actions">
                    <button type="button" @click="emit('preview', asset)">预览</button>
                    <button type="button" @click="downloadAsset(asset)">下载</button>
                    <button type="button" class="ghost-button" @click="removeAsset(asset.id)">删除</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
      <p v-else class="placeholder">暂未生成衍生素材，先上传文件吧。</p>
    </section>
  </div>
</template>

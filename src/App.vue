<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ImageGenerator from './components/ImageGenerator.vue'
import VideoGenerator from './components/VideoGenerator.vue'
import type { GeneratedAsset, ToastPayload } from './types'
import { generateId } from './utils/format'

const maxHistory = 20

type Tab = 'image' | 'video'
type ToastEntry = ToastPayload & { id: string }

const tabs: { label: string; value: Tab }[] = [
  { label: '图片占位', value: 'image' },
  { label: '视频占位', value: 'video' },
]

const activeTab = ref<Tab>('image')
const statusMessage = ref('')
const previewAsset = ref<GeneratedAsset | null>(null)
const toasts = ref<ToastEntry[]>([])

const toastTimers = new Map<string, number>()

const removeToast = (id: string) => {
  toasts.value = toasts.value.filter((toast) => toast.id !== id)
  if (toastTimers.has(id) && typeof window !== 'undefined') {
    window.clearTimeout(toastTimers.get(id))
  }
  toastTimers.delete(id)
}

const pushToast = ({ message, type }: ToastPayload) => {
  const toast: ToastEntry = { id: generateId(), message, type }
  toasts.value = [...toasts.value, toast]
  if (typeof window !== 'undefined') {
    const timer = window.setTimeout(() => removeToast(toast.id), 4000)
    toastTimers.set(toast.id, timer)
  }
}

const openPreview = (asset: GeneratedAsset) => {
  previewAsset.value = asset
}

const closePreview = () => {
  previewAsset.value = null
}

const downloadAsset = (asset: GeneratedAsset | null) => {
  if (!asset || !asset.url) return
  const link = document.createElement('a')
  link.href = asset.url
  link.download = asset.name
  document.body.append(link)
  link.click()
  link.remove()
}

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && previewAsset.value) {
    closePreview()
  }
}

if (typeof window !== 'undefined') {
  onMounted(() => {
    window.addEventListener('keydown', handleKeydown)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('keydown', handleKeydown)
    toastTimers.forEach((timer) => window.clearTimeout(timer))
    toastTimers.clear()
  })
}

watch(
  previewAsset,
  (asset) => {
    if (typeof document === 'undefined') return
    document.body.style.overflow = asset ? 'hidden' : ''
  },
  { flush: 'post' },
)

const latestActivity = computed(() =>
  statusMessage.value
    ? `${new Date().toLocaleTimeString()} · ${statusMessage.value}`
    : '准备就绪，填写参数后生成测试资源',
)
</script>

<template>
  <main class="page">
    <header class="hero">
      <div>
        <p class="eyebrow">测试资源工具</p>
        <h1>图片 / 视频占位生成器</h1>
        <p class="lead">
          根据配置快速创建占位素材，通过 Tabs 切换不同类型的生成器。
        </p>
      </div>
      <aside class="status-card">
        <p class="status-title">状态</p>
        <p class="status-text">{{ latestActivity }}</p>
      </aside>
    </header>

    <nav class="tabs">
      <button
        v-for="tab in tabs"
        :key="tab.value"
        type="button"
        :class="{ active: activeTab === tab.value }"
        @click="activeTab = tab.value"
      >
        {{ tab.label }}
      </button>
    </nav>

    <section class="panels" v-if="activeTab === 'image'">
      <ImageGenerator
        :max-history="maxHistory"
        @preview="openPreview"
        @toast="pushToast"
        @status="statusMessage = $event"
      />
    </section>

    <section class="panels" v-else>
      <VideoGenerator
        :max-history="maxHistory"
        @preview="openPreview"
        @toast="pushToast"
        @status="statusMessage = $event"
      />
    </section>
  </main>

  <teleport to="body">
    <div v-if="previewAsset" class="preview-overlay" @click="closePreview">
      <div class="preview-dialog" @click.stop>
        <header class="preview-header">
          <div>
            <p class="preview-subtitle">
              {{ previewAsset.kind === 'image' ? '图片预览' : '视频预览' }}
            </p>
            <h4>{{ previewAsset.name }}</h4>
            <p>{{ previewAsset.detail }} · {{ previewAsset.sizeLabel }}</p>
          </div>
          <button class="icon-button" type="button" aria-label="关闭" @click="closePreview">×</button>
        </header>
        <div class="preview-media">
          <img v-if="previewAsset.kind === 'image'" :src="previewAsset.url" :alt="previewAsset.name" />
          <video
            v-else
            :src="previewAsset.url"
            controls
            preload="metadata"
            autoplay
            loop
            playsinline
          ></video>
        </div>
        <footer class="preview-actions">
          <button class="primary" type="button" @click="downloadAsset(previewAsset)">下载</button>
          <button type="button" @click="closePreview">关闭</button>
        </footer>
      </div>
    </div>
  </teleport>

  <teleport to="body">
    <div class="toast-stack">
      <div v-for="toast in toasts" :key="toast.id" class="toast" :class="toast.type">
        <span>{{ toast.message }}</span>
        <button class="toast-close" type="button" @click="removeToast(toast.id)">×</button>
      </div>
    </div>
  </teleport>
</template>

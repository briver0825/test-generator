export type AssetStatus = 'pending' | 'ready' | 'error'

export type GeneratedAsset = {
  id: string
  kind: 'image' | 'video'
  url: string
  mime: string
  name: string
  detail: string
  size: number
  sizeLabel: string
  createdAt: number
  status?: AssetStatus
  progress?: number
  hash?: string
}

export type ToastPayload = {
  message: string
  type: 'success' | 'error'
}

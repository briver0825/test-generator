export const formatBytes = (bytes: number) => {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** index
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

export const generateId = () => (crypto?.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2))

export const computeHash = async (blob: Blob) => {
  if (typeof window === 'undefined' || !('crypto' in window) || !window.crypto.subtle) {
    return ''
  }
  const buffer = await blob.arrayBuffer()
  const digest = await window.crypto.subtle.digest('MD5', buffer).catch(() => null)
  if (!digest) return ''
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

import { FFmpeg } from '@ffmpeg/ffmpeg'
import { toBlobURL } from '@ffmpeg/util'

let instance: FFmpeg | null = null
let loadingPromise: Promise<FFmpeg> | null = null

const baseURL = '/ffmpeg'

const createInstance = async () => {
  const ffmpeg = new FFmpeg()
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
  })
  return ffmpeg
}

export const getFFmpeg = async () => {
  if (instance) return instance
  if (!loadingPromise) {
    loadingPromise = createInstance()
      .then((ffmpeg) => {
        instance = ffmpeg
        return ffmpeg
      })
      .catch((error) => {
        loadingPromise = null
        throw error
      })
  }
  return loadingPromise
}

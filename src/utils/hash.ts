import { getFFmpeg } from '../lib/ffmpeg'

export const computeFFmpegMD5 = async (blob: Blob) => {
  const ffmpeg = await getFFmpeg()
  const inputName = `hash-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`
  const data = new Uint8Array(await blob.arrayBuffer())
  await ffmpeg.writeFile(inputName, data)
  const output = `hash-${Date.now()}.txt`
  await ffmpeg.exec(['-i', inputName, '-f', 'md5', '-y', output])
  const content = await ffmpeg.readFile(output, 'utf8')
  await ffmpeg.deleteFile(inputName).catch(() => undefined)
  await ffmpeg.deleteFile(output).catch(() => undefined)
  return typeof content === 'string' ? content.trim().split('=')[1] ?? '' : ''
}

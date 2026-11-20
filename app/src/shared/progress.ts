/**
 * What a download window says about a running download (mock mocks/dl1.png): percent, size, speed, time left, and – when
 * nothing arrives for a minute – that the site may be throttling, with the way out after five minutes.
 */
export interface DownloadState {
  name: string
  got: number
  /** 0 when the site does not say how big the file is. */
  total: number
  /** Bytes per second, smoothed. */
  speed: number
  /** Milliseconds since the last byte arrived. */
  idle: number
}

export const STALL_MS = 60_000

const size = (b: number, unit?: 'GB' | 'MB') => {
  const u = unit ?? (b >= 1e9 ? 'GB' : 'MB')
  return u === 'GB' ? `${(b / 1e9).toFixed(2)} GB` : `${Math.max(0, Math.round(b / 1e6))} MB`
}

export function timeLeft(seconds: number): string {
  if (seconds < 60) return 'less than a minute left'
  const min = Math.round(seconds / 60)
  return min < 90 ? `about ${min} min left` : `about ${Math.round(min / 60)} h left`
}

export function progressText(s: DownloadState): { percent: string; head: string; line: string; title: string; warn?: string; fraction?: number } {
  const unit = s.total >= 1e9 ? 'GB' : 'MB'
  const fraction = s.total > 0 ? Math.min(1, s.got / s.total) : undefined
  const percent = fraction === undefined ? size(s.got) : `${Math.floor(fraction * 100)} %`
  const head = `Downloading “${s.name}” – ${s.total > 0 ? `${size(s.got, unit).replace(` ${unit}`, '')} of ${size(s.total, unit)}` : size(s.got)}`
  const stalled = s.idle >= STALL_MS
  const speed = s.speed > 0 && !stalled ? `${(s.speed / 1e6).toFixed(1)} MB/s` : ''
  const left = fraction !== undefined && s.speed > 0 && !stalled ? timeLeft((s.total - s.got) / s.speed) : ''
  const line = [speed, left, 'it is installed when it is complete. Closing this window stops the download.'].filter(Boolean).join(' · ')
  const title = stalled ? `Download paused? ${percent}` : ['Downloading', percent, speed, left].filter(Boolean).join(' · ')
  const warn = stalled
    ? `No data for ${Math.floor(s.idle / 60_000)} minute${s.idle >= 120_000 ? 's' : ''} – the site may be throttling or the connection dropped. Keep the window open, it goes on by itself. If nothing moves for 5 minutes: download the file in your browser and drop it onto the app window.`
    : undefined
  return { percent, head, line, title, warn, fraction }
}

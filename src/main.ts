import './style.css'
import { createConverter, directionLabel, type Direction } from './core/converter'
import { convertEpub } from './core/epub'
import { decodeUtf8, encodeUtf8 } from './core/txt'

type FileKind = 'txt' | 'epub'

interface CompletedFile {
  blob: Blob
  name: string
  chapterCount?: number
  changedCharacters: number
  elapsedMs: number
}

const app = document.querySelector<HTMLDivElement>('#app')!

app.innerHTML = `
  <main class="app-shell">
    <header class="masthead">
      <a class="brand" href="./" aria-label="繁简转换器首页">
        <span class="brand-mark" aria-hidden="true">繁</span>
        <span>繁简转换器</span>
      </a>
      <span class="local-badge">
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></svg>
        本地处理
      </span>
    </header>

    <section class="intro" aria-labelledby="page-title">
      <p class="eyebrow">LOCAL CHINESE CONVERTER</p>
      <h1 id="page-title">繁简转换器</h1>
      <p>在浏览器本地完成中文繁简转换</p>
    </section>

    <section class="workspace" aria-label="文件转换工作区">
      <input id="file-input" type="file" accept=".txt,.epub,text/plain,application/epub+zip" hidden />
      <button id="drop-zone" class="drop-zone" type="button">
        <span class="upload-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/></svg>
        </span>
        <strong>将文件拖到这里</strong>
        <span>或点击选择文件</span>
        <small>支持 TXT · EPUB</small>
      </button>

      <div id="file-view" class="file-view" hidden>
        <div class="file-summary">
          <span id="file-icon" class="file-icon" aria-hidden="true">TXT</span>
          <span class="file-copy">
            <strong id="file-name"></strong>
            <span id="file-meta"></span>
          </span>
          <button id="remove-file" class="icon-button" type="button" title="移除文件" aria-label="移除文件">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <div class="settings">
          <fieldset>
            <legend>转换方向</legend>
            <div class="segmented" id="direction-control">
              <label><input type="radio" name="direction" value="cn-to-tw" checked /><span>简体 <b>→</b> 繁體</span></label>
              <label><input type="radio" name="direction" value="tw-to-cn" /><span>繁體 <b>→</b> 简体</span></label>
            </div>
          </fieldset>
          <div class="format-row">
            <span>输出格式</span>
            <strong id="output-format">TXT</strong>
          </div>
        </div>

        <div id="notice" class="notice" role="status" aria-live="polite" hidden></div>

        <button id="convert-button" class="primary-button" type="button">
          <span>开始转换</span>
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
        </button>
      </div>

      <div id="result-view" class="result-view" hidden>
        <div class="success-heading">
          <span aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg></span>
          <div><p>转换完成</p><strong id="result-name"></strong></div>
        </div>
        <dl class="result-stats">
          <div><dt>转换方向</dt><dd id="result-direction"></dd></div>
          <div id="chapter-stat" hidden><dt>正文文件</dt><dd id="result-chapters"></dd></div>
          <div><dt>变更字符</dt><dd id="result-characters"></dd></div>
          <div><dt>转换耗时</dt><dd id="result-duration"></dd></div>
        </dl>
        <div class="result-actions">
          <button id="download-button" class="primary-button" type="button">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>
            <span>下载文件</span>
          </button>
          <button id="another-button" class="secondary-button" type="button">转换其他文件</button>
        </div>
      </div>
    </section>

    <footer>
      <p><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/></svg>文件不会离开你的设备</p>
      <span>基于 OpenCC</span>
    </footer>
  </main>
`

const fileInput = getElement<HTMLInputElement>('file-input')
const dropZone = getElement<HTMLButtonElement>('drop-zone')
const fileView = getElement<HTMLDivElement>('file-view')
const resultView = getElement<HTMLDivElement>('result-view')
const convertButton = getElement<HTMLButtonElement>('convert-button')
const notice = getElement<HTMLDivElement>('notice')

let selectedFile: File | null = null
let selectedKind: FileKind | null = null
let completed: CompletedFile | null = null
let downloadUrl: string | null = null

dropZone.addEventListener('click', () => fileInput.click())
fileInput.addEventListener('change', () => {
  if (fileInput.files?.[0]) selectFile(fileInput.files[0])
})

for (const eventName of ['dragenter', 'dragover']) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault()
    dropZone.classList.add('is-dragging')
  })
}
for (const eventName of ['dragleave', 'drop']) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault()
    dropZone.classList.remove('is-dragging')
  })
}
dropZone.addEventListener('drop', (event) => {
  const file = event.dataTransfer?.files[0]
  if (file) selectFile(file)
})

getElement('remove-file').addEventListener('click', reset)
getElement('another-button').addEventListener('click', reset)
convertButton.addEventListener('click', runConversion)
getElement('download-button').addEventListener('click', downloadResult)

function selectFile(file: File): void {
  clearNotice()
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension !== 'txt' && extension !== 'epub') {
    showDropError('暂不支持该文件格式，请选择 TXT 或 EPUB 文件。')
    return
  }
  selectedFile = file
  selectedKind = extension
  getElement('file-icon').textContent = extension.toUpperCase()
  getElement('file-icon').className = `file-icon ${extension}`
  getElement('file-name').textContent = file.name
  getElement('file-meta').textContent = `${formatBytes(file.size)} · ${extension.toUpperCase()}`
  getElement('output-format').textContent = extension.toUpperCase()
  dropZone.hidden = true
  resultView.hidden = true
  fileView.hidden = false
}

async function runConversion(): Promise<void> {
  if (!selectedFile || !selectedKind) return
  const direction = getDirection()
  const startedAt = performance.now()
  setBusy(true)
  showStatus('正在读取文件…')
  try {
    const input = await selectedFile.arrayBuffer()
    let blob: Blob
    let chapterCount: number | undefined
    let changedCharacters = 0
    if (selectedKind === 'txt') {
      const decoded = decodeUtf8(new Uint8Array(input))
      showStatus('正在转换文本…')
      await nextFrame()
      const convert = await createConverter(direction)
      const converted = convert(decoded.text)
      changedCharacters = converted.changedCharacters
      blob = new Blob([toArrayBuffer(encodeUtf8(converted, decoded.hasUtf8Bom))], { type: 'text/plain;charset=utf-8' })
    } else {
      showStatus('正在处理 EPUB…')
      const converted = await convertEpub(input, direction, showStatus)
      chapterCount = converted.chapterCount
      changedCharacters = converted.changedCharacters
      blob = new Blob([toArrayBuffer(converted.bytes)], { type: 'application/epub+zip' })
    }
    completed = {
      blob,
      name: outputName(selectedFile.name, direction),
      chapterCount,
      changedCharacters,
      elapsedMs: performance.now() - startedAt,
    }
    showResult(completed, direction)
  } catch (error) {
    showError(friendlyError(error, selectedKind))
  } finally {
    setBusy(false)
  }
}

function showResult(result: CompletedFile, direction: Direction): void {
  fileView.hidden = true
  resultView.hidden = false
  getElement('result-name').textContent = result.name
  getElement('result-direction').textContent = directionLabel(direction)
  getElement('result-characters').textContent = result.changedCharacters.toLocaleString('zh-CN')
  getElement('result-duration').textContent = formatDuration(result.elapsedMs)
  const chapterStat = getElement('chapter-stat')
  chapterStat.hidden = result.chapterCount === undefined
  if (result.chapterCount !== undefined) getElement('result-chapters').textContent = `${result.chapterCount} 个`
}

function downloadResult(): void {
  if (!completed) return
  if (downloadUrl) URL.revokeObjectURL(downloadUrl)
  downloadUrl = URL.createObjectURL(completed.blob)
  const link = document.createElement('a')
  link.href = downloadUrl
  link.download = completed.name
  link.click()
}

function reset(): void {
  selectedFile = null
  selectedKind = null
  completed = null
  fileInput.value = ''
  fileView.hidden = true
  resultView.hidden = true
  dropZone.hidden = false
  clearNotice()
  if (downloadUrl) URL.revokeObjectURL(downloadUrl)
  downloadUrl = null
}

function getDirection(): Direction {
  return document.querySelector<HTMLInputElement>('input[name="direction"]:checked')?.value as Direction ?? 'cn-to-tw'
}

function setBusy(busy: boolean): void {
  convertButton.disabled = busy
  convertButton.classList.toggle('is-busy', busy)
  document.querySelectorAll<HTMLInputElement>('input[name="direction"]').forEach((input) => { input.disabled = busy })
  getElement<HTMLButtonElement>('remove-file').disabled = busy
}

function showStatus(message: string): void {
  notice.className = 'notice status'
  notice.innerHTML = `<span class="spinner" aria-hidden="true"></span><span></span>`
  notice.querySelector('span:last-child')!.textContent = message
  notice.hidden = false
}

function showError(message: string): void {
  notice.className = 'notice error'
  notice.textContent = message
  notice.hidden = false
}

function showDropError(message: string): void {
  dropZone.classList.add('has-error')
  const original = dropZone.querySelector('small')!
  original.textContent = message
  window.setTimeout(() => {
    dropZone.classList.remove('has-error')
    original.textContent = '支持 TXT · EPUB'
  }, 3500)
}

function clearNotice(): void {
  notice.hidden = true
  notice.textContent = ''
}

function friendlyError(error: unknown, kind: FileKind): string {
  const message = error instanceof Error ? error.message : ''
  if (message.includes('UTF-8')) return message
  if (message.includes('文本编码')) return '该 EPUB 包含暂不支持的正文编码，为避免损坏原文件，转换已停止。'
  if (message.includes('mimetype')) return '无法读取该 EPUB 文件，请确认它是有效且未损坏的 EPUB。'
  if (message.includes('container.xml') || message.includes('OPF')) return 'EPUB 结构不完整，无法找到书籍内容。'
  if (message.includes('正文')) return '该 EPUB 中没有找到可转换的正文文件。'
  return kind === 'epub' ? '无法转换该 EPUB 文件，请确认文件未损坏。' : '文件转换失败，请重新选择后再试。'
}

function outputName(name: string, direction: Direction): string {
  const lastDot = name.lastIndexOf('.')
  const base = lastDot > 0 ? name.slice(0, lastDot) : name
  const extension = lastDot > 0 ? name.slice(lastDot) : ''
  return `${base}-${direction === 'cn-to-tw' ? '繁体' : '简体'}${extension}`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDuration(milliseconds: number): string {
  return milliseconds < 1000 ? `${Math.round(milliseconds)} ms` : `${(milliseconds / 1000).toFixed(1)} s`
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function getElement<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T
}

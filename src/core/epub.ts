import JSZip from 'jszip'
import type { Direction } from './converter'
import { createConverter } from './converter'

export interface EpubConversionResult {
  bytes: Uint8Array
  chapterCount: number
  changedCharacters: number
}

interface ManifestItem {
  id: string
  href: string
  mediaType: string
  properties: string
}

export async function convertEpub(
  input: ArrayBuffer,
  direction: Direction,
  onStatus?: (message: string) => void,
): Promise<EpubConversionResult> {
  const source = await JSZip.loadAsync(input)
  const entryNames = Object.keys(source.files)
  const mimetypeEntry = source.files.mimetype
  if (!mimetypeEntry) throw new Error('EPUB 缺少 mimetype 文件。')
  const mimetype = await mimetypeEntry.async('uint8array')
  if (new TextDecoder().decode(mimetype) !== 'application/epub+zip') {
    throw new Error('EPUB 的 mimetype 文件内容无效。')
  }

  onStatus?.('正在读取 EPUB 结构…')
  const containerEntry = source.files['META-INF/container.xml']
  if (!containerEntry) throw new Error('无法找到 EPUB 的 container.xml。')
  const containerXml = await decodeXmlEntry(containerEntry)
  const rootfileMatch = /<rootfile\b[^>]*?full-path\s*=\s*["']([^"']+)["'][^>]*>/i.exec(containerXml)
  if (!rootfileMatch) throw new Error('无法找到 EPUB 的 OPF 文件。')
  const opfPath = normalizePath(rootfileMatch[1])
  const opfEntry = source.files[opfPath]
  if (!opfEntry) throw new Error('无法读取 EPUB 的 OPF 文件。')
  const opfXml = await decodeXmlEntry(opfEntry)

  const manifest = parseManifest(opfXml)
  const spineIds = Array.from(opfXml.matchAll(/<itemref\b([^>]*?)>/gi))
    .map((match) => readAttribute(match[1], 'idref'))
    .filter((id): id is string => Boolean(id))
  const opfDirectory = directoryOf(opfPath)
  const spineDocuments = spineIds
    .map((id) => manifest.find((item) => item.id === id))
    .filter((item): item is ManifestItem => Boolean(item))
    .filter((item) => isHtmlItem(item) && !item.properties.split(/\s+/).includes('nav'))
  if (spineDocuments.length === 0) throw new Error('无法找到 EPUB 的正文文件。')

  const convert = await createConverter(direction)
  let changedCharacters = 0
  let chapterCount = 0
  const modified = new Map<string, Uint8Array>()

  for (const item of spineDocuments) {
    const path = normalizePath(joinPath(opfDirectory, decodeHref(item.href)))
    const entry = source.files[path]
    if (!entry || entry.dir) continue
    chapterCount += 1
    onStatus?.(`正在处理第 ${chapterCount} / ${spineDocuments.length} 章…`)
    const originalBytes = await entry.async('uint8array')
    const decoded = decodeTextBytes(originalBytes)
    const transformed = convertBodyText(decoded.text, convert)
    changedCharacters += transformed.changedCharacters
    if (transformed.text !== decoded.text) {
      modified.set(path, encodeTextBytes(transformed.text, decoded.hasUtf8Bom))
    }
    await yieldToBrowser()
  }
  if (chapterCount === 0) throw new Error('无法读取 EPUB 的正文文件。')

  onStatus?.('正在重新打包 EPUB…')
  const output = new JSZip()
  const orderedNames = ['mimetype', ...entryNames.filter((name) => name !== 'mimetype')]
  for (const name of orderedNames) {
    const entry = source.files[name]
    if (!entry) continue
    if (entry.dir) {
      output.folder(name)
      continue
    }
    const bytes = modified.get(name) ?? await entry.async('uint8array')
    output.file(name, bytes, {
      compression: name === 'mimetype' ? 'STORE' : 'DEFLATE',
      date: entry.date,
      comment: entry.comment,
      unixPermissions: entry.unixPermissions,
      dosPermissions: entry.dosPermissions,
      createFolders: false,
    })
  }
  const blob = await output.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
  return { bytes: blob, chapterCount, changedCharacters }
}

function parseManifest(opf: string): ManifestItem[] {
  return Array.from(opf.matchAll(/<item\b([^>]*?)>/gi)).flatMap((match) => {
    const attributes = match[1]
    const id = readAttribute(attributes, 'id')
    const href = readAttribute(attributes, 'href')
    const mediaType = readAttribute(attributes, 'media-type')
    if (!id || !href || !mediaType) return []
    return [{ id, href, mediaType, properties: readAttribute(attributes, 'properties') ?? '' }]
  })
}

function isHtmlItem(item: ManifestItem): boolean {
  return item.mediaType === 'application/xhtml+xml' || item.mediaType === 'text/html' || /\.(xhtml?|html?)$/i.test(item.href)
}

function readAttribute(attributes: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(attributes)
  return match?.[1]
}

function decodeHref(href: string): string {
  try {
    return decodeURIComponent(href.split('#', 1)[0])
  } catch {
    return href.split('#', 1)[0]
  }
}

function joinPath(directory: string, relative: string): string {
  return `${directory}${relative}`
}

function directoryOf(path: string): string {
  const index = path.lastIndexOf('/')
  return index === -1 ? '' : path.slice(0, index + 1)
}

function normalizePath(path: string): string {
  const parts: string[] = []
  for (const part of path.replaceAll('\\', '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/')
}

async function decodeXmlEntry(entry: JSZip.JSZipObject): Promise<string> {
  return decodeTextBytes(await entry.async('uint8array')).text
}

function decodeTextBytes(bytes: Uint8Array): { text: string; hasUtf8Bom: boolean } {
  const hasUtf8Bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), hasUtf8Bom }
  } catch {
    throw new Error('EPUB 正文包含暂不支持的文本编码。')
  }
}

function encodeTextBytes(text: string, hasUtf8Bom: boolean): Uint8Array {
  const encoded = new TextEncoder().encode(text)
  if (!hasUtf8Bom) return encoded
  const bytes = new Uint8Array(encoded.length + 3)
  bytes.set([0xef, 0xbb, 0xbf])
  bytes.set(encoded, 3)
  return bytes
}

export function convertBodyText(text: string, convert: (value: string) => { text: string; changedCharacters: number }): { text: string; changedCharacters: number } {
  let output = ''
  let cursor = 0
  let bodyDepth = 0
  let skipDepth = 0
  let changedCharacters = 0

  while (cursor < text.length) {
    const tagStart = text.indexOf('<', cursor)
    if (tagStart === -1) {
      const chunk = text.slice(cursor)
      if (bodyDepth > 0 && skipDepth === 0) {
        const converted = convert(chunk)
        output += converted.text
        changedCharacters += converted.changedCharacters
      } else output += chunk
      break
    }
    if (tagStart > cursor) {
      const chunk = text.slice(cursor, tagStart)
      if (bodyDepth > 0 && skipDepth === 0) {
        const converted = convert(chunk)
        output += converted.text
        changedCharacters += converted.changedCharacters
      } else output += chunk
    }

    if (text.startsWith('<!--', tagStart)) {
      const end = text.indexOf('-->', tagStart + 4)
      const stop = end === -1 ? text.length : end + 3
      output += text.slice(tagStart, stop)
      cursor = stop
      continue
    }
    if (text.startsWith('<![CDATA[', tagStart)) {
      const end = text.indexOf(']]>', tagStart + 9)
      const stop = end === -1 ? text.length : end + 3
      output += text.slice(tagStart, stop)
      cursor = stop
      continue
    }
    const tagEnd = findTagEnd(text, tagStart)
    const stop = tagEnd === -1 ? text.length : tagEnd + 1
    const tag = text.slice(tagStart, stop)
    output += tag
    const parsed = parseTag(tag)
    if (isElement(parsed.name, 'body') && !parsed.closing && !parsed.selfClosing) bodyDepth += 1
    if (isElement(parsed.name, 'body') && parsed.closing) bodyDepth = Math.max(0, bodyDepth - 1)
    if (isSkippedElement(parsed.name) && !parsed.closing && !parsed.selfClosing) skipDepth += 1
    if (isSkippedElement(parsed.name) && parsed.closing) skipDepth = Math.max(0, skipDepth - 1)
    cursor = stop
  }
  return { text: output, changedCharacters }
}

function isSkippedElement(name: string): boolean {
  return isElement(name, 'script') || isElement(name, 'style') || isElement(name, 'svg')
}

function isElement(name: string, localName: string): boolean {
  return name === localName || name.endsWith(`:${localName}`)
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve())
    else setTimeout(resolve, 0)
  })
}

function findTagEnd(text: string, start: number): number {
  let quote = ''
  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index]
    if (quote) {
      if (char === quote) quote = ''
    } else if (char === '"' || char === "'") quote = char
    else if (char === '>') return index
  }
  return -1
}

function parseTag(tag: string): { name: string; closing: boolean; selfClosing: boolean } {
  const match = /^<\s*(\/)?\s*([A-Za-z][\w:.-]*)/.exec(tag)
  if (!match) return { name: '', closing: false, selfClosing: true }
  return { name: match[2].toLowerCase(), closing: Boolean(match[1]), selfClosing: /\/\s*>$/.test(tag) }
}

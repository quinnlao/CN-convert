import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { createConverter } from '../src/core/converter'
import { convertBodyText, convertEpub } from '../src/core/epub'
import { decodeUtf8, encodeUtf8 } from '../src/core/txt'

describe('TXT format preservation', () => {
  it('preserves BOM, CRLF, blank lines, indentation, tabs and non-Chinese content', async () => {
    const inputText = '\ufeff第一章　這是一個故事。\r\n\r\n　　這一天，天氣很好。\r\n\t他走在 Street 42 #A_1！\r\n'
    const input = new TextEncoder().encode(inputText)
    const decoded = decodeUtf8(input)
    const converted = (await createConverter('tw-to-cn'))(decoded.text)
    const output = encodeUtf8(converted, decoded.hasUtf8Bom)
    const text = new TextDecoder().decode(output)

    expect(decoded.hasUtf8Bom).toBe(true)
    expect(Array.from(output.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf])
    expect(text).toBe('第一章　这是一个故事。\r\n\r\n　　这一天，天气很好。\r\n\t他走在 Street 42 #A_1！\r\n')
    expect(text.match(/\r\n/g)?.length).toBe(4)
  })

  it('converts writing-system forms without localizing regional expressions', async () => {
    const toSimplified = await createConverter('tw-to-cn')
    const toTraditional = await createConverter('cn-to-tw')

    expect(toSimplified('這個軟體與滑鼠')).toMatchObject({ text: '这个软体与滑鼠' })
    expect(toSimplified('影像、文字檔案、聯絡、訊息、視窗、網路影片')).toMatchObject({
      text: '影像、文字档案、联络、讯息、视窗、网路影片',
    })
    expect(toSimplified('帶著、乾脆、麵糰、頭髮')).toMatchObject({ text: '带着、干脆、面团、头发' })
    expect(toTraditional('这个软体与滑鼠')).toMatchObject({ text: '這個軟體與滑鼠' })
  })
})

describe('XHTML in-place text conversion', () => {
  it('changes body text nodes without serializing markup, attributes, comments, SVG or script', async () => {
    const source = '<?xml version="1.0"?>\n<html><head><title>繁體書名</title></head><body class="繁體-class">\n  <p class="text"><span>這是一段</span><em>繁體中文</em>。</p><!-- 繁體註解 -->\n  <svg><text>繁體圖形</text></svg><script>const 名稱 = "繁體";</script>\n</body></html>'
    const output = convertBodyText(source, await createConverter('tw-to-cn')).text
    expect(output).toBe('<?xml version="1.0"?>\n<html><head><title>繁體書名</title></head><body class="繁體-class">\n  <p class="text"><span>这是一段</span><em>繁体中文</em>。</p><!-- 繁體註解 -->\n  <svg><text>繁體圖形</text></svg><script>const 名稱 = "繁體";</script>\n</body></html>')
  })
})

describe('EPUB conversion', () => {
  it('preserves resources and EPUB structure while converting all spine documents', async () => {
    const source = await createFixtureEpub()
    const before = await JSZip.loadAsync(source)
    const result = await convertEpub(toArrayBuffer(source), 'tw-to-cn')
    const after = await JSZip.loadAsync(result.bytes)

    expect(result.chapterCount).toBe(2)
    expect(await after.file('OEBPS/Text/chapter1.xhtml')!.async('text')).toBe(
      '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章</title></head><body>\n<p class="lead"><span>这是</span><em>繁体</em><strong>软体</strong>。</p>\n</body></html>',
    )
    expect(await after.file('OEBPS/Text/chapter2.xhtml')!.async('text')).toContain('<p>天气很好。\tChapter 2</p>')

    for (const path of ['OEBPS/style.css', 'OEBPS/image.png', 'OEBPS/nav.xhtml', 'OEBPS/content.opf', 'META-INF/container.xml']) {
      expect(await after.file(path)!.async('uint8array')).toEqual(await before.file(path)!.async('uint8array'))
    }
    expect(Object.keys(after.files)).toEqual(Object.keys(before.files))
    expect(firstZipEntry(result.bytes)).toEqual({ name: 'mimetype', compressionMethod: 0 })
    expect(await after.file('mimetype')!.async('text')).toBe('application/epub+zip')
  })

  it('rejects an EPUB whose mimetype is not exact', async () => {
    const zip = new JSZip()
    zip.file('mimetype', 'application/epub+zip\n', { compression: 'STORE' })
    zip.file('META-INF/container.xml', '<container/>')
    const bytes = await zip.generateAsync({ type: 'uint8array' })
    await expect(convertEpub(toArrayBuffer(bytes), 'tw-to-cn')).rejects.toThrow('mimetype')
  })
})

async function createFixtureEpub(): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file('META-INF/container.xml', '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
  zip.file('OEBPS/content.opf', '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf"><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">繁體書名</dc:title></metadata><manifest><item id="c1" href="Text/chapter1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="Text/chapter2.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="style.css" media-type="text/css"/><item id="img" href="image.png" media-type="image/png"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>')
  zip.file('OEBPS/Text/chapter1.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章</title></head><body>\n<p class="lead"><span>這是</span><em>繁體</em><strong>軟體</strong>。</p>\n</body></html>')
  zip.file('OEBPS/Text/chapter2.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>第二章</h1>\n\n<p>天氣很好。\tChapter 2</p><img src="../image.png"/></body></html>')
  zip.file('OEBPS/nav.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><body><nav><a href="Text/chapter1.xhtml">繁體目錄</a></nav></body></html>')
  zip.file('OEBPS/style.css', '.lead { text-indent: 2em; font-family: serif; }')
  zip.file('OEBPS/image.png', new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

function firstZipEntry(bytes: Uint8Array): { name: string; compressionMethod: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  expect(view.getUint32(0, true)).toBe(0x04034b50)
  const compressionMethod = view.getUint16(8, true)
  const nameLength = view.getUint16(26, true)
  const name = new TextDecoder().decode(bytes.slice(30, 30 + nameLength))
  return { name, compressionMethod }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

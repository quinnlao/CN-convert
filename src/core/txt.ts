import type { ConversionResult } from './converter'

export interface DecodedText {
  text: string
  hasUtf8Bom: boolean
}

export function decodeUtf8(bytes: Uint8Array): DecodedText {
  const hasUtf8Bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true })
    return { text: decoder.decode(bytes), hasUtf8Bom }
  } catch {
    throw new Error('TXT 文件不是有效的 UTF-8 编码，暂不支持读取。')
  }
}

export function encodeUtf8(result: ConversionResult, hasUtf8Bom: boolean): Uint8Array {
  const encoded = new TextEncoder().encode(result.text)
  if (!hasUtf8Bom) return encoded
  const output = new Uint8Array(encoded.length + 3)
  output.set([0xef, 0xbb, 0xbf])
  output.set(encoded, 3)
  return output
}

export type Direction = 'cn-to-tw' | 'tw-to-cn'

export interface ConversionResult {
  text: string
  changedCharacters: number
}

export async function createConverter(direction: Direction): Promise<(text: string) => ConversionResult> {
  const converter = direction === 'cn-to-tw'
    ? (await import('opencc-js/cn2t')).default.Converter({ from: 'cn', to: 'tw' })
    : (await import('opencc-js/t2cn')).default.Converter({ from: 'tw', to: 'cn' })

  return (text: string) => {
    const converted = converter(text)
    return {
      text: converted,
      changedCharacters: countChangedCharacters(text, converted),
    }
  }
}

function countChangedCharacters(before: string, after: string): number {
  const left = Array.from(before)
  const right = Array.from(after)
  let changed = Math.abs(left.length - right.length)
  const shared = Math.min(left.length, right.length)
  for (let index = 0; index < shared; index += 1) {
    if (left[index] !== right[index]) changed += 1
  }
  return changed
}

export function directionLabel(direction: Direction): string {
  return direction === 'cn-to-tw' ? '简体中文 → 繁體中文' : '繁體中文 → 简体中文'
}

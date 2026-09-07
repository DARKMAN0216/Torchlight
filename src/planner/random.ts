export type Random = () => number
export function seededRandom(seed: number): Random {
  let value = seed >>> 0
  return () => {
    value += 0x6D2B79F5
    let x = Math.imul(value ^ value >>> 15, 1 | value)
    x ^= x + Math.imul(x ^ x >>> 7, 61 | x)
    return ((x ^ x >>> 14) >>> 0) / 4294967296
  }
}
export function pick<T>(values: readonly T[], random: Random): T {
  if (!values.length) throw new Error('不能从空集合采样')
  return values[Math.floor(random() * values.length)]
}
export function shuffled<T>(values: readonly T[], random: Random): T[] {
  const result = [...values]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

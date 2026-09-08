export type Random = (() => number) & { choose?: (weights: number[]) => number }
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
  if (values.length === 1) return values[0]
  return values[random.choose ? random.choose(values.map(() => 1 / values.length)) : Math.floor(random() * values.length)]
}
export function chance(probability: number, random: Random): boolean {
  if (probability === 0) return false
  if (probability === 1) return true
  return random.choose ? random.choose([probability, 1 - probability]) === 0 : random() < probability
}
export function shuffled<T>(values: readonly T[], random: Random): T[] {
  const result = [...values]
  for (let i = result.length - 1; i > 0; i--) {
    const j = pick(Array.from({ length: i + 1 }, (_, j) => j), random)
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

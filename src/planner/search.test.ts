import { describe, expect, it } from 'vitest'
import { board, model, play, runtime } from './fixtures.test-support'
import { checkOrderSensitivity, recommend, summarize } from './search'
import { createPlannerModel } from './catalog'

const quick = { simulations: 16, policySamples: 2, policyDepth: 0, seed: 123, maxTransitions: 50000 }
describe('stochastic policy evaluation', () => {
  it('produces reproducible terminal statistics and does not use fixed card strength', () => {
    const s = board({ offeredCardIds: ['small', 'large'] })
    const m = model([
      { id: 'small', name: 'small', effects: [{ type: 'stats', target: { mode: 'all' }, activity: 5 }] },
      { id: 'large', name: 'large', effects: [{ type: 'stats', target: { mode: 'all' }, activity: 10 }] },
    ])
    const first = recommend(s, m, quick), second = recommend(s, m, quick)
    expect(first.status).toBe('complete')
    expect(first.recommendation).toEqual(play('large'))
    expect(first.estimates).toEqual(second.estimates)
    expect(first.estimates[0]).toMatchObject({ mean: 200, p10: 200, p90: 200, standardError: 0 })
  })
  it('averages lottery branches instead of keeping only lucky outcomes', () => {
    const s = board({ offeredCardIds: ['lottery', 'safe'] })
    const m = model([
      { id: 'lottery', name: 'lottery', effects: [{ type: 'chance', probability: .1,
        effects: [{ type: 'stats', target: { mode: 'all' }, activity: 200 }] }] },
      { id: 'safe', name: 'safe', effects: [{ type: 'stats', target: { mode: 'all' }, activity: 30 }] },
    ])
    const result = recommend(s, m, { ...quick, simulations: 1000 })
    expect(result.recommendation).toEqual(play('safe'))
    const lottery = result.estimates.find(e => e.action.type === 'playCard' && e.action.cardId === 'lottery')!
    expect(lottery.mean).toBeGreaterThan(250); expect(lottery.mean).toBeLessThan(350)
  })
  it('does not know round-10 random offers when selecting a round-9 route', () => {
    const s = board({ round: 9, offeredCardIds: ['route-a', 'route-b'] })
    const m = model([
      { id: 'route-a', name: 'A', effects: [{ type: 'mutate', target: { mode: 'all' }, race: 'swarm' }] },
      { id: 'route-b', name: 'B', effects: [{ type: 'mutate', target: { mode: 'all' }, race: 'construct' }] },
      { id: 'pay-a', name: 'payA', effects: [{ type: 'stats', target: { mode: 'all', filter: { race: 'swarm' } }, activity: 100 }] },
      { id: 'pay-b', name: 'payB', effects: [{ type: 'stats', target: { mode: 'all', filter: { race: 'construct' } }, activity: 100 }] },
    ])
    m.offerPool = ['pay-a', 'pay-b']
    const result = recommend(s, m, { ...quick, simulations: 600 })
    expect(result.status).toBe('complete')
    for (const estimate of result.estimates) {
      expect(estimate.mean).toBeGreaterThan(530)
      expect(estimate.mean).toBeLessThan(670) // true expected 600; a clairvoyant policy would get 1100.
    }
  })
  it('future policy observes the offer before choosing among its visible cards', () => {
    const s = board({ round: 9 })
    const m = model([
      { id: 'noop', name: 'noop', effects: [] },
      { id: 'small', name: 'small', effects: [{ type: 'stats', target: { mode: 'all' }, activity: 1 }] },
      { id: 'large', name: 'large', effects: [{ type: 'stats', target: { mode: 'all' }, activity: 100 }] },
    ])
    m.offerPool = ['small', 'large']; m.offerCount = 2
    const result = recommend(s, m, { ...quick, policyDepth: 1, beamWidth: 2 })
    expect(result.estimates[0].mean).toBe(1100)
  })
  it('counts surgery-only passive value through the end of round 13', () => {
    const s = board({ round: 11, persistentEffects: [runtime('dirty-bone-scraper')] })
    s.slots[0].monster!.quantity = 280
    const result = recommend(s, createPlannerModel(), quick)
    expect(result.recommendation).toEqual({ type: 'advanceSurgeryPlanRound' })
    expect(result.estimates[0].mean).toBe(19600)
  })
  it('plans from round 1 through 13 and values delayed equipment above a larger immediate gain', () => {
    const s = board({ round: 1, offeredCardIds: ['equip', 'immediate'] })
    s.slots[0].monster!.quantity = 280
    const m = createPlannerModel({ cards: [
      { id: 'noop', name: 'noop', effects: [] },
      { id: 'equip', name: 'equip', effects: [], acquirePersistentId: 'dirty-bone-scraper' },
      { id: 'immediate', name: 'immediate', effects: [{ type: 'stats', target: { mode: 'all' }, activity: 80 }] },
    ], offerPool: ['noop'], offerCount: 1 })
    const result = recommend(s, m, { ...quick, simulations: 4 })
    expect(result.recommendation).toEqual(play('equip'))
    expect(result.estimates[0].mean).toBe(280 * (10 + 12 * 20))
    expect(result.estimates[1].mean).toBe(280 * 90)
  })
  it('compares redraw as an action using its resulting visible offer', () => {
    const s = board({ redrawsRemaining: 1 })
    const m = model([
      { id: 'noop', name: 'noop', effects: [] },
      { id: 'large', name: 'large', effects: [{ type: 'stats', target: { mode: 'all' }, activity: 100 }] },
    ])
    m.offerPool = ['large']
    expect(recommend(s, m, quick).recommendation).toEqual({ type: 'redraw' })
  })
  it('unknown current cards block global ranking instead of silently disappearing', () => {
    const m = model([
      { id: 'noop', name: 'noop', effects: [] },
      { id: 'unknown', name: 'unknown', effects: [], unsupportedReason: '缺失复制规则' },
    ])
    const result = recommend(board({ offeredCardIds: ['noop', 'unknown'] }), m, quick)
    expect(result.status).toBe('blocked'); expect(result.recommendation).toBeUndefined()
    expect(result.issues[0]).toContain('缺失复制规则')
  })
  it('known holes in future pools block even if random sampling might miss them', () => {
    const result = recommend(board({ round: 9 }), model([
      { id: 'noop', name: 'noop', effects: [] },
      { id: 'unknown', name: 'unknown', effects: [], unsupportedReason: 'unknown' },
    ]), quick)
    expect(result.status).toBe('blocked'); expect(result.transitions).toBe(0)
  })
  it('returns no recommendation when transition budget is exhausted', () => {
    const result = recommend(board(), model(), { ...quick, maxTransitions: 2 })
    expect(result.status).toBe('budgetExceeded'); expect(result.recommendation).toBeUndefined()
  })
  it('blocks unresolved recognition and refuses invalid budgets', () => {
    expect(recommend(board({ recognitionReview: ['槽1数量不明'] }), model(), quick).status).toBe('blocked')
    expect(() => recommend(board(), model(), { simulations: 0 })).toThrow('参数')
  })
  it('reports conditional model confidence separately from Monte Carlo standard error', () => {
    const result = recommend(board(), model(), quick)
    expect(result.estimates[0].standardError).toBe(0)
    expect(result.estimates[0].modelConfidence).toBe('conditional')
    expect(result.assumptions).toEqual(['测试假设'])
  })
  it('detects recommendations that reverse under noncommutative passive orders', () => {
    const s = board({ persistentEffects: [runtime('multiply'), runtime('add', 2)], offeredCardIds: ['swarm', 'construct'] })
    const m = model([
      { id: 'swarm', name: 's', effects: [] },
      { id: 'construct', name: 'c', effects: [
        { type: 'mutate', target: { mode: 'all' }, race: 'construct' },
        { type: 'stats', target: { mode: 'all' }, activity: 200 },
      ] },
    ])
    m.persistent = [
      { id: 'multiply', name: 'm', triggers: [{ event: 'roundEnd',
        effects: [{ type: 'stats', target: { mode: 'all', filter: { race: 'swarm' } }, activityFactor: 2 }] }] },
      { id: 'add', name: 'a', triggers: [{ event: 'roundEnd',
        effects: [{ type: 'stats', target: { mode: 'all', filter: { race: 'swarm' } }, activity: 10 }] }] },
    ]
    // Four remaining settlements: swarm gives 310 vs 460 per unit; construct gets 360.
    m.cards[1].effects[1] = { type: 'stats', target: { mode: 'all' }, activity: 350 }
    const result = checkOrderSensitivity(s, m, quick)
    expect(result.status).toBe('sensitive')
    expect(result.scenarios[0].report.recommendation).toEqual(play('construct'))
    expect(result.scenarios[1].report.recommendation).toEqual(play('swarm'))
  })
  it('calculates interpolated empirical quantiles without claiming a guaranteed floor', () => {
    expect(summarize([0, 10, 20, 30, 40])).toMatchObject({ mean: 20, median: 20, p10: 4, p90: 36 })
  })
})

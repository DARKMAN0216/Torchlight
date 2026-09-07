import { observedRun } from '../data/observedRun'
import { candidateCards } from '../data/sampleLibrary'
import { createPlannerModel } from '../planner/catalog'
import { fromLegacyState } from '../planner/observations'
import { finalActivity, simulateAction } from '../planner/simulator'
import type { GameState } from '../types/game'
import { activity, appendStep, createRun, finishRun, type ObservedAction, type RunArchive, type RunFrame } from './archive'
import { buildValueDataset, classifyRuns } from './dataset'
import { evaluateValueModel, fitValueModel } from './value'

function historicalFrame(id: string, state: GameState, passives: string[], offered: string[], phase: RunFrame['phase']): RunFrame {
  return { id, evidence: id, state: structuredClone(state), phase, confidence: 1,
    displayedActivity: state.monsters.reduce((n, m) => n + m.quantity * m.unitActivity, 0),
    offerId: offered.length ? id : null, offersComplete: offered.length > 0,
    offered: offered.map(name => ({ name, cardId: candidateCards.find(c => c.name === name)?.id ?? null })),
    passives: passives.map(cardId => ({ cardId, acquiredRound: null })), redrawsRemaining: null }
}
/** One historical run, NOT eleven independent games. Missing rewards/timestamps remain missing. */
export function importHistoricalRun(): RunArchive {
  let run = createRun({ runId: 'historical-screenshot-run-2026-09-03', provenance: 'real',
    gameVersion: 'historical-version-unconfirmed', rulesVersion: 'observedRun-v1' })
  const frames = new Map<string, RunFrame>()
  for (const s of observedRun) frames.set(s.sourceBefore, historicalFrame(s.sourceBefore, s.before, s.persistentCardIds,
    s.offeredCardNames, s.offeredCardNames.length === 5 ? 'expanded' : 'potion'))
  for (const s of observedRun) if (!frames.has(s.sourceAfter)) {
    const phase = ({ potionSelection: 'potion', surgeryRewardSelection: 'permanent',
      expandedPotionSelection: 'expanded', surgeryPlanSelection: 'surgery' } as const)[s.afterPhase]
    frames.set(s.sourceAfter, historicalFrame(s.sourceAfter, s.after, s.persistentCardIds, [], phase))
  }
  for (const s of observedRun) {
    const card = candidateCards.find(c => c.id === s.chosenCardId)!
    const random = card.targeting?.mode === 'observedRandom'
    const ids = s.context.selectedMonsterIds ?? []
    const action: ObservedAction = { type: 'play', cardId: card.id, cardName: card.name,
      confirmation: 'manual', targetMode: random ? 'random' : ids.length ? 'choose' : 'none',
      selectedSlotIds: random ? [] : ids, observedRandomSlotIds: random ? ids : [], targetsConfirmed: true }
    const after = frames.get(s.sourceAfter)!
    if (activity(after) !== s.displayedFinalActivity) throw new Error('历史来源映射冲突：' + s.id)
    run = appendStep(run, { id: s.id, before: frames.get(s.sourceBefore)!, action,
      after, singleActionConfirmed: true })
  }
  return run // It stops at round 11. NEVER invent its round-13 terminal outcome.
}

/** Controlled synthetic plumbing fixture. No claims of measured gameplay or learned strategy. */
export function syntheticTrainingRuns(count = 40): RunArchive[] {
  return Array.from({ length: count }, (_, index) => {
    const runId = 'synthetic-flow-' + index
    let run = createRun({ runId, provenance: 'synthetic', gameVersion: 'synthetic-v1', rulesVersion: 'synthetic-linear-growth-v1' })
    const makeFrame = (round: number): RunFrame => {
      const quantity = 10 + index, unitActivity = 10 + (round - 1) * 2
      return { id: `${runId}/frame-${round}`, evidence: 'synthetic:fixed-integer-growth',
        state: { round, mode: 'activity', monsters: Array.from({ length: 6 }, (_, i) => ({ id: `slot-${i + 1}`,
          race: i === 0 ? 'swarm' : null, rarity: 'common', quantity: i === 0 ? quantity : 0, unitActivity: i === 0 ? unitActivity : 0 })) },
        phase: round === 14 ? 'terminal' : round > 10 ? 'surgery' : 'potion', confidence: 1,
        displayedActivity: quantity * unitActivity, offerId: round <= 10 ? `${runId}/offer-${round}` : null,
        offersComplete: round <= 10, offered: round <= 10 ? [{ name: '合成加成', cardId: 'synthetic-growth' }] : [],
        passives: [], redrawsRemaining: 0 }
    }
    for (let round = 1; round <= 13; round++) run = appendStep(run, {
      id: `${runId}/step-${round}`, before: makeFrame(round), after: makeFrame(round + 1), singleActionConfirmed: true,
      action: { type: round > 10 ? 'advanceSurgery' : 'play', cardId: round > 10 ? null : 'synthetic-growth',
        cardName: round > 10 ? null : '合成加成', confirmation: 'manual', targetMode: 'none',
        selectedSlotIds: [], observedRandomSlotIds: [], targetsConfirmed: true },
    })
    return finishRun(run, { kind: 'confirmed-terminal', frame: makeFrame(14) })
  })
}

export function replayHistoricalChecks() {
  const checkedIds = ['round-5-digestive-enzyme-and-dirty-bone-scraper', 'round-8-digestive-enzyme-and-dirty-bone-scraper',
    'round-10-birth-bone-powder-and-dirty-bone-scraper']
  return observedRun.map(sample => {
    if (!checkedIds.includes(sample.id)) return { id: sample.id, status: 'not-validated', reason: '未迁移规则/随机归因/奖励边界需独立验证，不冒充回放成功' }
    const state = fromLegacyState(sample.before, { persistentEffects: sample.persistentCardIds.map(cardId => ({
      cardId, acquiredRound: 1, firstEligibleRound: 2, triggerCount: 0, enabled: true,
    })), offeredCardIds: [sample.chosenCardId], redrawsRemaining: 0, specialPotionStage: 0 })
    // The three checks have no effective random target ambiguity; this does NOT validate random probabilities.
    const result = simulateAction(state, { type: 'playCard', cardId: sample.chosenCardId,
      selectedSlotIds: sample.chosenCardId === 'birth-bone-powder' ? [] : sample.context.selectedMonsterIds ?? [] },
    createPlannerModel({ offerPool: ['soft-meningeal-solution'], offerCount: 1 }), () => 0)
    const actual = sample.after.monsters.map(m => [m.race, m.rarity, m.quantity, m.unitActivity])
    const predicted = result.state.slots.map(s => s.monster ? [s.monster.race, s.monster.rarity, s.monster.quantity, s.monster.unitActivity] : [null, 'common', 0, 0])
    return { id: sample.id, status: JSON.stringify(actual) === JSON.stringify(predicted) ? 'matched' : 'mismatch',
      predictedActivity: finalActivity(result.state), actualActivity: sample.displayedFinalActivity }
  })
}
export function verifyLearningPipeline() {
  const historical = importHistoricalRun()
  const realDataset = buildValueDataset([historical])
  const synthetic = syntheticTrainingRuns()
  const syntheticDataset = buildValueDataset(synthetic)
  const model = fitValueModel(syntheticDataset.samples, 'synthetic-technical-verification-v1')
  return { historical, synthetic, model, report: {
    scope: '离线记录/分类/经验学习技术验证；未接桌面自动采集，未训练生产推荐策略。',
    historicalAudit: classifyRuns([historical]), realTrainingRows: realDataset.samples.length,
    realTrainingExclusions: realDataset.excluded, replay: replayHistoricalChecks(),
    synthetic: { label: '合成数据，仅验证技术流程', runs: synthetic.length, rows: syntheticDataset.samples.length,
      trainingRunIds: model.trainingRunIds, validation: evaluateValueModel(model, syntheticDataset.samples, 'validation'),
      test: evaluateValueModel(model, syntheticDataset.samples, 'test') },
    deploymentDecision: 'not-ready: 真实完整终局数据不足；禁止据此替换现有推荐。',
  } }
}

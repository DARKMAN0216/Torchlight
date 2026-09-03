import { raceLabels, rarityLabels } from '../data/sampleLibrary'
import {
  raceIds,
  rarityIds,
  type CardTargeting,
  type DecisionMode,
  type GameState,
  type MonsterGroup,
  type PersistentCard,
  type RaceId,
  type RarityId,
  type ResolutionObservation,
} from '../types/game'
import { NumberField } from './NumberField'

interface StatePanelProps {
  state: GameState
  persistentIds: string[]
  persistentCards: PersistentCard[]
  onStateChange: (state: GameState) => void
  onPersistentToggle: (id: string) => void
  persistentLocked?: boolean
  roundEndAction?: {
    description: string
    due: boolean
    awaiting: boolean
    everyRounds?: number
    onResolve: () => void
    onSkip: () => void
  }
  targetSelection?: {
    cardName: string
    prompt: string
    mode: 'choose' | 'observedRandom'
    selectedIds: string[]
    minTargets: number
    maxTargets: number
    valid: boolean
    excludeBoss: boolean
    disabledIds: string[]
    observedRaces?: CardTargeting['observedRaces']
    resolutionObservation?: ResolutionObservation
    resolutionComplete: boolean
    observedRaceByMonsterId: Partial<Record<string, RaceId>>
    observedNewGroupRaces: Array<RaceId | ''>
    observedRemovedMonsterIds: Array<string | ''>
    observedPersistentTriggerTargetIds: Array<string | ''>
    persistentRemovalTrigger?: PersistentCard['onRemovalQuantityBonus']
    onToggle: (id: string) => void
    onObservedTargetRaceChange: (id: string, race: RaceId | '') => void
    onObservedNewGroupRaceChange: (index: number, race: RaceId | '') => void
    onObservedRemovedTargetChange: (index: number, id: string | '') => void
    onObservedPersistentTriggerTargetChange: (index: number, id: string | '') => void
    onConfirm: () => void
    onCancel: () => void
  }
}

export function StatePanel({
  state,
  persistentIds,
  persistentCards,
  onStateChange,
  onPersistentToggle,
  persistentLocked = false,
  roundEndAction,
  targetSelection,
}: StatePanelProps) {
  const updateMonster = (id: string, changes: Partial<MonsterGroup>) => {
    onStateChange({
      ...state,
      monsters: state.monsters.map((monster) =>
        monster.id === id ? { ...monster, ...changes } : monster,
      ),
    })
  }

  const updateRace = (monster: MonsterGroup, race: RaceId | null) => {
    updateMonster(monster.id, race
      ? { race }
      : { race: null, rarity: 'common', quantity: 0, unitActivity: 0 })
  }

  const selectedPersistents = persistentCards.filter(
    (card) => persistentIds.includes(card.id),
  )
  const observedRacesComplete = !targetSelection?.observedRaces || (
    targetSelection.observedRaces.mode === 'perTarget'
      ? targetSelection.selectedIds.every((id) => targetSelection.observedRaceByMonsterId[id])
      : targetSelection.observedNewGroupRaces.every(Boolean)
  )
  const primaryTarget = state.monsters.find(
    (monster) => targetSelection?.selectedIds[0] === monster.id,
  )
  const removalObservation = targetSelection?.resolutionObservation?.removals
  const removalCandidates = state.monsters.filter((monster) =>
    monster.race &&
    !targetSelection?.selectedIds.includes(monster.id) &&
    (!removalObservation?.differentRaceFromPrimaryTarget || monster.race !== primaryTarget?.race),
  )
  const removedIds = new Set(
    targetSelection?.observedRemovedMonsterIds.filter(Boolean) as string[] | undefined,
  )
  const persistentTriggerCandidates = state.monsters.filter(
    (monster) => monster.race && !removedIds.has(monster.id),
  )

  return (
    <aside className="panel state-panel">
      <div className="panel-heading">
        <div>
          <h2>本局状态</h2>
          <p>六个怪物槽分别录入，位置从左到右</p>
        </div>
      </div>

      <span className="field-label" id="persistent-card-label">常驻手术用具（可追加）</span>
      <div className="persistent-card-picker" role="group" aria-labelledby="persistent-card-label">
        {persistentCards.map((card) => (
          <label key={card.id} className={persistentIds.includes(card.id) ? 'selected' : ''}>
            <input
              type="checkbox"
              checked={persistentIds.includes(card.id)}
              disabled={persistentLocked}
              onChange={() => onPersistentToggle(card.id)}
            />
            <span>{card.name}</span>
          </label>
        ))}
      </div>
      <div className="persistent-descriptions">
        {selectedPersistents.map((card) => (
          <p className="field-help" key={card.id}><strong>{card.name}：</strong>{card.description}</p>
        ))}
      </div>
      {state.mode === 'strategic' && (
        <p className="strategy-profile-note">
          <strong>战略模型：</strong>
          {selectedPersistents
            .map((card) => card.strategicProfile?.summary)
            .filter(Boolean)
            .join('；') || '当前常驻组合暂无专属协同规则，仅计算活性、阵容完整度和稀有度潜力。'}
        </p>
      )}

      {roundEndAction && (
        <div className={`round-end-card ${roundEndAction.awaiting ? 'awaiting' : ''}`}>
          <div>
            <strong>回合结束效果</strong>
            <span>{roundEndAction.description}</span>
            <small>
              {roundEndAction.awaiting
                ? '候选卡已结算，完成这里后才会进入下一轮。'
                : roundEndAction.due
                  ? '本轮触发：选择候选卡后将提示结算。'
                  : `本轮不触发${roundEndAction.everyRounds ? `（每 ${roundEndAction.everyRounds} 回合）` : ''}。`}
            </small>
          </div>
          {roundEndAction.awaiting && (
            <div className="round-end-actions">
              <button type="button" className="primary-button compact" onClick={roundEndAction.onResolve}>
                结算回合结束效果
              </button>
              <button type="button" className="secondary-button" onClick={roundEndAction.onSkip}>
                无触发，跳过
              </button>
            </div>
          )}
        </div>
      )}

      <div className="field-row">
        <div>
          <label className="field-label" htmlFor="round">当前轮次</label>
          <NumberField
            label="当前轮次"
            min={1}
            value={state.round}
            onChange={(round) => onStateChange({ ...state, round })}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="decision-mode">决策模式</label>
          <select
            id="decision-mode"
            value={state.mode}
            onChange={(event) =>
              onStateChange({ ...state, mode: event.target.value as DecisionMode })
            }
          >
            <option value="activity">即时活性最高</option>
            <option value="preserve">保留阵容（启发式）</option>
            <option value="strategic">常驻协同（战略模型）</option>
          </select>
        </div>
      </div>

      <div className="monster-title">
        <h3>怪物槽位</h3>
        <span>{state.monsters.filter((monster) => monster.race).length}/6 已占用</span>
      </div>
      {targetSelection && (
        <div className="target-selection-banner" role="status">
          <div>
            <strong>{targetSelection.cardName}</strong>
            <span>
              {targetSelection.mode === 'observedRandom' ? '记录随机结果：' : '选择效果目标：'}
              {targetSelection.prompt}
            </span>
            <small>
              已选择 {targetSelection.selectedIds.length}/{targetSelection.maxTargets}
              {targetSelection.excludeBoss ? ' · 首领已达上限，不能作为升阶目标' : ''}
            </small>
          </div>
          {targetSelection.observedRaces && (
            <div className="observed-race-fields">
              <small>{targetSelection.observedRaces.prompt}</small>
              {targetSelection.observedRaces.mode === 'perTarget'
                ? targetSelection.selectedIds.map((monsterId) => {
                    const slotIndex = state.monsters.findIndex((monster) => monster.id === monsterId)
                    return (
                      <label key={monsterId}>
                        <span>槽位 {slotIndex + 1} 结果</span>
                        <select
                          aria-label={`槽位 ${slotIndex + 1} 实际随机种群`}
                          value={targetSelection.observedRaceByMonsterId[monsterId] ?? ''}
                          onChange={(event) => targetSelection.onObservedTargetRaceChange(
                            monsterId,
                            event.target.value as RaceId | '',
                          )}
                        >
                          <option value="">请选择实际种群</option>
                          {raceIds.map((race) => (
                            <option value={race} key={race}>{raceLabels[race]}</option>
                          ))}
                        </select>
                      </label>
                    )
                  })
                : targetSelection.observedNewGroupRaces.map((raceValue, index) => (
                    <label key={index}>
                      <span>新增怪物 {index + 1}</span>
                      <select
                        aria-label={`新增怪物 ${index + 1} 实际随机种群`}
                        value={raceValue}
                        onChange={(event) => targetSelection.onObservedNewGroupRaceChange(
                          index,
                          event.target.value as RaceId | '',
                        )}
                      >
                        <option value="">请选择实际种群</option>
                        {raceIds.map((race) => (
                          <option value={race} key={race}>{raceLabels[race]}</option>
                        ))}
                      </select>
                    </label>
                  ))}
            </div>
          )}
          {removalObservation && (
            <div className="observed-resolution-fields">
              <small>{removalObservation.prompt}</small>
              {targetSelection.observedRemovedMonsterIds.map((monsterId, index) => (
                <label key={`removed-${index}`}>
                  <span>实际移除 {index + 1}</span>
                  <select
                    aria-label={`第 ${index + 1} 个实际移除槽位`}
                    value={monsterId}
                    disabled={!primaryTarget}
                    onChange={(event) => targetSelection.onObservedRemovedTargetChange(
                      index,
                      event.target.value,
                    )}
                  >
                    <option value="">请选择被移除槽位</option>
                    {removalCandidates.map((monster) => {
                      const slotIndex = state.monsters.findIndex((item) => item.id === monster.id)
                      const usedElsewhere = targetSelection.observedRemovedMonsterIds.some(
                        (selectedId, selectedIndex) => selectedIndex !== index && selectedId === monster.id,
                      )
                      return (
                        <option value={monster.id} key={monster.id} disabled={usedElsewhere}>
                          槽位 {slotIndex + 1} · {raceLabels[monster.race!]}
                        </option>
                      )
                    })}
                  </select>
                </label>
              ))}
            </div>
          )}
          {targetSelection.observedPersistentTriggerTargetIds.length > 0 && (
            <div className="observed-resolution-fields">
              <small>
                {targetSelection.persistentRemovalTrigger
                  ? `记录常驻卡每次 +${targetSelection.persistentRemovalTrigger.amount} 数量的实际随机目标（可重复）`
                  : '记录常驻卡的实际随机目标'}
              </small>
              {targetSelection.observedPersistentTriggerTargetIds.map((monsterId, index) => (
                <label key={`persistent-trigger-${index}`}>
                  <span>第 {index + 1} 次触发</span>
                  <select
                    aria-label={`常驻卡第 ${index + 1} 次随机目标`}
                    value={monsterId}
                    onChange={(event) => targetSelection.onObservedPersistentTriggerTargetChange(
                      index,
                      event.target.value,
                    )}
                  >
                    <option value="">请选择实际命中槽位</option>
                    {persistentTriggerCandidates.map((monster) => {
                      const slotIndex = state.monsters.findIndex((item) => item.id === monster.id)
                      return (
                        <option value={monster.id} key={monster.id}>
                          槽位 {slotIndex + 1} · {raceLabels[monster.race!]}
                        </option>
                      )
                    })}
                  </select>
                </label>
              ))}
            </div>
          )}
          <div className="target-selection-actions">
            <button type="button" className="secondary-button" onClick={targetSelection.onCancel}>
              取消
            </button>
            <button
              type="button"
              className="primary-button compact"
              disabled={
                !targetSelection.valid ||
                !observedRacesComplete ||
                !targetSelection.resolutionComplete
              }
              onClick={targetSelection.onConfirm}
            >
              确认结算
            </button>
          </div>
        </div>
      )}
      <div className="rarity-legend" aria-label="稀有度颜色说明">
        {rarityIds.map((rarity) => (
          <span key={rarity}>
            <i className={`rarity-dot rarity-${rarity}`} />
            {rarityLabels[rarity]}{rarity === 'boss' ? ' / Boss' : ''}
          </span>
        ))}
      </div>
      <div className="monster-table" role="table" aria-label="六槽怪物状态">
        <div className="monster-row monster-header" role="row">
          <span role="columnheader">目标</span>
          <span role="columnheader">槽</span>
          <span role="columnheader">种群</span>
          <span role="columnheader">稀有度</span>
          <span role="columnheader">数量</span>
          <span role="columnheader">单体活性</span>
        </div>
        {state.monsters.map((monster, index) => {
          const occupied = monster.race !== null
          const selected = targetSelection?.selectedIds.includes(monster.id) ?? false
          const targetDisabled = targetSelection?.disabledIds.includes(monster.id) ?? false
          const bossExcluded = Boolean(targetSelection?.excludeBoss && monster.rarity === 'boss')
          return (
            <div
              className={`monster-row monster-slot rarity-border-${monster.rarity}`}
              role="row"
              key={monster.id}
            >
              <div className="monster-target-cell" role="cell">
                {targetSelection ? (
                  <input
                    type="checkbox"
                    aria-label={`选择槽位 ${index + 1} 作为效果目标`}
                    checked={selected}
                    disabled={!occupied || targetDisabled}
                    title={bossExcluded
                      ? '首领已达最高稀有度，升阶不会生效'
                      : targetDisabled
                        ? '该怪物不符合当前效果的目标条件'
                        : undefined}
                    onChange={() => targetSelection.onToggle(monster.id)}
                  />
                ) : (
                  <span aria-hidden="true">—</span>
                )}
              </div>
              <strong role="cell" aria-label={`槽位 ${index + 1}`}>{index + 1}</strong>
              <div role="cell">
                <select
                  aria-label={`槽位 ${index + 1} 种群`}
                  value={monster.race ?? ''}
                  onChange={(event) => updateRace(monster, (event.target.value || null) as RaceId | null)}
                >
                  <option value="">空槽</option>
                  {raceIds.map((race) => <option value={race} key={race}>{raceLabels[race]}</option>)}
                </select>
              </div>
              <div role="cell">
                <select
                  aria-label={`槽位 ${index + 1} 稀有度`}
                  className={`rarity-select rarity-${monster.rarity}`}
                  disabled={!occupied}
                  value={monster.rarity}
                  onChange={(event) => updateMonster(monster.id, { rarity: event.target.value as RarityId })}
                >
                  {rarityIds.map((rarity) => (
                    <option value={rarity} key={rarity}>{rarityLabels[rarity]}</option>
                  ))}
                </select>
              </div>
              <div role="cell">
                <NumberField
                  label={`槽位 ${index + 1} 数量`}
                  disabled={!occupied}
                  value={monster.quantity}
                  onChange={(quantity) => updateMonster(monster.id, { quantity })}
                />
              </div>
              <div role="cell">
                <NumberField
                  label={`槽位 ${index + 1} 单体活性`}
                  disabled={!occupied}
                  value={monster.unitActivity}
                  onChange={(unitActivity) => updateMonster(monster.id, { unitActivity })}
                />
                {occupied && (
                  <small className="group-total-activity">
                    总计 {monster.quantity * monster.unitActivity}
                  </small>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <p className="panel-note">
        稀有度按普通白、魔法蓝、稀有黄、首领红记录；首领不会再次进阶，空槽不参与计算。
      </p>
    </aside>
  )
}

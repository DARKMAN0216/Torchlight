import { describe, expect, it, vi, afterEach } from 'vitest'
import { builtinMonsterNames, loadMonsterDictionary, monsterDictionary, parseMonsterDictionary, resolveMonsterName, serializeMonsterDictionary, upsertMonsterName } from './monsterDictionary'
import { candidateCards, initialCandidateIds, initialState } from '../data/sampleLibrary'
import { mergeRecognitionSnapshot } from './merge'
import type { RecognitionSnapshot, RecognizedMonsterSlot } from './contracts'

const slot = (name = '寄生蝴蝶'): RecognizedMonsterSlot => ({ slotId: 'slot-1', occupied: {value:true,confidence:1}, name:{value:name,confidence:.99} })
afterEach(() => { vi.unstubAllGlobals() })
describe('monster name dictionary', () => {
  it('contains twelve user mappings including the special cocoon', () => {
    expect(builtinMonsterNames).toHaveLength(12)
    expect(monsterDictionary().get('空心茧')).toEqual({ name: '空心茧', race: 'swarm', rarity: 'boss' })
    const dictionary = monsterDictionary()
    expect(dictionary.get('堕落者')).toMatchObject({race:'awakened',rarity:'magic'})
    expect(dictionary.get('朝圣者')).toMatchObject({race:'awakened',rarity:'magic'})
    for (const entry of builtinMonsterNames) expect(resolveMonsterName(slot(entry.name),dictionary).slot)
      .toMatchObject({raceId:{value:entry.race},rarity:{value:entry.rarity}})
  })
  it('uses whole names only and does not guess spelling or substring aliases', () => {
    for (const name of ['学者','邪眼翼兽','寄生蝴碟']) expect(resolveMonsterName(slot(name),monsterDictionary()).slot.raceId).toBeUndefined()
    expect(resolveMonsterName(slot(' 寄生 蝴蝶 '),monsterDictionary()).slot.raceId?.value).toBe('swarm')
  })
  it('does not trust low confidence names or empty slots', () => {
    const low = slot(); low.name!.confidence = .84
    expect(resolveMonsterName(low,monsterDictionary()).slot.raceId).toBeUndefined()
    const empty = slot(); empty.occupied.value = false
    expect(resolveMonsterName(empty,monsterDictionary()).slot.raceId).toBeUndefined()
  })
  it('preserves unknown-name fallback but trusts known names over visual conflicts', () => {
    const unknown = {...slot('未知怪物'), raceId:{value:'construct' as const,confidence:.9}}
    expect(resolveMonsterName(unknown,monsterDictionary()).slot).toEqual(unknown)
    const conflict = {...slot(),raceId:{value:'construct' as const,confidence:.9},rarity:{value:'boss' as const,confidence:.9}}
    expect(resolveMonsterName(conflict,monsterDictionary()).issues).toEqual([])
    expect(resolveMonsterName(conflict,monsterDictionary()).slot).toMatchObject({raceId:{value:'swarm'},rarity:{value:'rare'}})
    expect(resolveMonsterName({...conflict,raceId:{value:'construct',confidence:.4},rarity:undefined},monsterDictionary()).slot.raceId?.value).toBe('swarm')
  })
  it('requires explicit same-name replacement and keeps distinct names', () => {
    const entry = {name:'寄生蝴蝶',race:'swarm',rarity:'boss'}
    expect(() => upsertMonsterName([],entry)).toThrow('覆盖')
    const custom = upsertMonsterName([],entry,true)
    expect(monsterDictionary(custom).get('寄生蝴蝶')?.rarity).toBe('boss')
    expect(upsertMonsterName(custom,entry)).toHaveLength(1)
    expect(upsertMonsterName(custom,{name:'新种蝴蝶',race:'swarm',rarity:'boss'})).toHaveLength(2)
  })
  it('roundtrips portable records and rejects invalid imports atomically', () => {
    const custom = upsertMonsterName([],{name:'学者',race:'awakened',rarity:'common'})
    expect(parseMonsterDictionary(serializeMonsterDictionary(custom))).toEqual(custom)
    for (const input of [{version:2,entries:[]},{version:1,entries:[...custom,...custom]},
      {version:1,entries:[{name:'abc',race:'swarm',rarity:'rare'}]},
      {version:1,entries:[{name:'学者',race:'invented',rarity:'rare'}]}]) {
      expect(() => parseMonsterDictionary(JSON.stringify(input))).toThrow()
    }
    expect(custom).toHaveLength(1)
  })
  it('loads versioned storage and reports corruption without overwriting it', () => {
    const setItem = vi.fn()
    vi.stubGlobal('localStorage',{getItem:()=>'{broken',setItem})
    expect(loadMonsterDictionary().error).toContain('读取失败')
    expect(setItem).not.toHaveBeenCalled()
    vi.stubGlobal('localStorage',{getItem:()=>serializeMonsterDictionary([])})
    expect(loadMonsterDictionary()).toEqual({entries:[],error:''})
  })
  it('applies manual records on the next snapshot without color veto or stale review', () => {
    const snapshot: RecognitionSnapshot = {capturedAt:'',candidateCardIds:[],displayedFinalActivity:{value:10,confidence:1},
      monsterSlots:initialState.monsters.map((monster,index)=>index ? {slotId:monster.id,occupied:{value:false,confidence:1}} :
        {...slot('学者'),quantity:{value:2,confidence:1},unitActivity:{value:5,confidence:1},displayedTotalActivity:{value:10,confidence:1}})}
    const custom = upsertMonsterName([],{name:'学者',race:'awakened',rarity:'common'})
    const result = mergeRecognitionSnapshot(initialState,initialCandidateIds,3,snapshot,candidateCards,[],custom)
    expect(result.state.monsters[0]).toMatchObject({race:'awakened',rarity:'common',quantity:2,unitActivity:5})
    expect(result.state.recognitionReview).toEqual([])
    snapshot.monsterSlots![0].rarity = {value:'rare',confidence:.98}
    const conflict = mergeRecognitionSnapshot(initialState,initialCandidateIds,3,snapshot,candidateCards,[],custom)
    expect(conflict.state.monsters[0].rarity).toBe('common')
    expect(conflict.state.recognitionReview).toEqual([])
    const stale = {...initialState,recognitionReview:['slot-1 旧颜色冲突']}
    expect(mergeRecognitionSnapshot(stale,initialCandidateIds,3,snapshot,candidateCards,[],custom).state.recognitionReview).toEqual([])
  })
  it('uses custom overrides even when visual evidence agrees with the built-in record', () => {
    const custom = upsertMonsterName([],{name:'蝎兽',race:'swarm',rarity:'boss'},true)
    const observed = {...slot('蝎兽'),raceId:{value:'aberrant' as const,confidence:1},rarity:{value:'common' as const,confidence:1}}
    expect(resolveMonsterName(observed,monsterDictionary(custom)).slot).toMatchObject({raceId:{value:'swarm'},rarity:{value:'boss'}})
  })
})

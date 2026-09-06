import { describe, it, expect } from 'vitest'
import { persistentCards } from '../data/sampleLibrary'
import { choicePermanent, receiveChoices, validChoiceRecords, type ChoiceRecord } from './choiceTracking'
const record: ChoiceRecord = { id:'one',round:1,phase:'surgeryRewardSelection',name:'肿大脑垂体',cardIndex:0,status:'transition-observed',targetSlots:[] }
describe('passive choice journal', () => {
  it('records the newly structured raised-card choices', () => {
    for (const [name, id] of [['斑斓肝脏','mottled-liver'],['人蛹标本','human-pupa']]) {
      expect(receiveChoices([], [{...record,name}], ['none'],persistentCards).ids).toEqual([id])
    }
  })
  it('appends verified permanent once and persists dedup through reload', () => {
    const next=receiveChoices([], [record,record], ['none'], persistentCards)
    expect(next.ids).toEqual(['hypertrophic-pituitary'])
    expect(next.log).toHaveLength(1)
    expect(receiveChoices(JSON.parse(JSON.stringify(next.log)),[record],next.ids,persistentCards).changed).toBe(false)
  })
  it('does not add uncertain, merely selected, unknown or potion entries', () => {
    for (const r of [{...record,status:'uncertain' as const},{...record,status:'selected' as const},
      {...record,name:'肿大脑垂本'},{...record,phase:'potionSelection'}]) {
      expect(receiveChoices([], [r], ['none'],persistentCards).ids).toEqual(['none'])
    }
  })
  it('uses explicit aliases but no fuzzy match for automatic loadout writes', () => {
    expect(choicePermanent({...record,name:'蔓生肉芽'},persistentCards)?.id).toBe('aberrant-bud')
    expect(choicePermanent({...record,name:'肿大脑'},persistentCards)).toBeUndefined()
  })
  it('validates persisted data and bounds history', () => {
    expect(validChoiceRecords([null,{}, {...record,targetSlots:[7]},record])).toEqual([record])
    expect(receiveChoices([],Array.from({length:120},(_,i)=>({...record,id:String(i)})),['none'],persistentCards).log).toHaveLength(100)
  })
  it('preserves other permanent choices', () => {
    expect(receiveChoices([], [record], ['contracted-claw'],persistentCards).ids).toEqual(['contracted-claw','hypertrophic-pituitary'])
  })
})

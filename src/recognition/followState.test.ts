import { describe, it, expect } from 'vitest'
import { followNeedsSynchronization, snapshotIdentity } from './followState'
import type { FollowState } from './localBridge'
import type { RecognitionSnapshot } from './contracts'

describe('follow snapshot deduplication',()=>{
  it('keeps confirmed recommendations during background checks, not real changes or disconnects',()=>{
    const follow: FollowState={enabled:true,generation:1,status:'checking',message:'后台复查'}
    expect(followNeedsSynchronization(follow,true)).toBe(false)
    expect(followNeedsSynchronization({...follow,status:'following'},true)).toBe(false)
    for(const status of ['settling','recognizing','waiting'] as const) {
      expect(followNeedsSynchronization({...follow,status},true)).toBe(true)
    }
    expect(followNeedsSynchronization(follow,false)).toBe(true)
    expect(followNeedsSynchronization(follow,null)).toBe(true)
    expect(followNeedsSynchronization({...follow,enabled:false},true)).toBe(false)
  })
  const snapshot: RecognitionSnapshot={capturedAt:'a',candidateCardIds:[],round:{value:7,confidence:.9},candidateCardNames:[{value:'清疽油膏',confidence:.9}]}
  it('ignores timestamps and confidence jitter',()=>{
    expect(snapshotIdentity(snapshot)).toBe(snapshotIdentity({...snapshot,capturedAt:'b',round:{value:7,confidence:.99}}))
  })
  it('retains same-round card and reroll changes',()=>{
    expect(snapshotIdentity(snapshot)).not.toBe(snapshotIdentity({...snapshot,rerollsRemaining:{value:2,confidence:1}}))
    expect(snapshotIdentity(snapshot)).not.toBe(snapshotIdentity({...snapshot,candidateCardNames:[{value:'生骨药粉',confidence:.99}]}))
  })
})

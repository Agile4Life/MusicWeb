import { describe, expect, it } from 'vitest'
import { createBattle, chooseWinner, undoChoice, currentPair } from '../songBattle'

const songs = Array.from({ length: 8 }, (_, i) => ({ id: String(i), title: `Song ${i}` }))

describe('song battle', () => {
  it('requires enough distinct contestants and a power-of-two size', () => {
    expect(() => createBattle(songs, 3)).toThrow()
    expect(() => createBattle(songs.slice(0, 3), 4)).toThrow()
    expect(() => createBattle([songs[0], songs[0]], 2)).toThrow()
  })

  it.each([2, 4, 8])('finishes a %i-song bracket in n-1 choices without repeating eliminated songs', size => {
    let battle = createBattle(songs, size)
    const eliminated = new Set<string>()
    for (let i = 0; i < size - 1; i++) {
      const pair = currentPair(battle)!
      expect(pair.every(track => !eliminated.has(track.id))).toBe(true)
      eliminated.add(pair[1].id)
      battle = chooseWinner(battle, pair[0].id, battle.history.length)
    }
    expect(battle.champion?.id).toBe(battle.entrants[0].id)
    expect(battle.history).toHaveLength(size - 1)
    expect(currentPair(battle)).toBeNull()
  })

  it('undoes across round boundaries and the final, allowing a different winner', () => {
    let battle = createBattle(songs, 4)
    const first = currentPair(battle)!
    battle = chooseWinner(battle, first[0].id, 0)
    const second = currentPair(battle)!
    battle = chooseWinner(battle, second[1].id, 1)
    const final = currentPair(battle)!
    battle = chooseWinner(battle, final[0].id, 2)
    battle = undoChoice(battle)
    expect(currentPair(battle)).toEqual(final)
    battle = undoChoice(battle)
    expect(currentPair(battle)).toEqual(second)
    expect(undoChoice(undoChoice(battle)).history).toHaveLength(0)
  })

  it('ignores stale repeated votes and candidates outside the current match', () => {
    const battle = createBattle(songs, 4)
    const next = chooseWinner(battle, currentPair(battle)![0].id, 0)
    expect(chooseWinner(next, currentPair(next)![0].id, 0)).toBe(next)
    expect(chooseWinner(battle, 'missing', 0)).toBe(battle)
  })
})

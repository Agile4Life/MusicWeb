export interface Contestant { id: string }
export interface BattleChoice<T> { left: T; right: T; winner: T; roundSize: number }
export interface Battle<T> {
  entrants: T[]
  round: T[]
  winners: T[]
  match: number
  history: BattleChoice<T>[]
  champion: T | null
}

export function createBattle<T extends Contestant>(pool: T[], size: number): Battle<T> {
  if (!Number.isInteger(size) || size < 2 || size > 256 || (size & (size - 1)) !== 0) {
    throw new Error('Số bài phải là lũy thừa của 2, từ 2 đến 256.')
  }
  const distinct = [...new Map(pool.map(track => [track.id, track])).values()]
  if (distinct.length < size) throw new Error('Chưa đủ bài hát để bắt đầu.')
  const shuffled = [...distinct]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  const entrants = shuffled.slice(0, size)
  return { entrants, round: entrants, winners: [], match: 0, history: [], champion: null }
}

export function currentPair<T>(battle: Battle<T>): [T, T] | null {
  if (battle.champion) return null
  return [battle.round[battle.match * 2], battle.round[battle.match * 2 + 1]]
}

export function chooseWinner<T extends Contestant>(battle: Battle<T>, id: string, expectedTurn: number): Battle<T> {
  if (expectedTurn !== battle.history.length) return battle
  const pair = currentPair(battle)
  const winner = pair?.find(track => track.id === id)
  if (!pair || !winner) return battle
  const winners = [...battle.winners, winner]
  const history = [...battle.history, { left: pair[0], right: pair[1], winner, roundSize: battle.round.length }]
  if (battle.round.length === 2) return { ...battle, history, champion: winner }
  if (winners.length === battle.round.length / 2) {
    return { ...battle, round: winners, winners: [], match: 0, history }
  }
  return { ...battle, winners, match: battle.match + 1, history }
}

export function undoChoice<T extends Contestant>(battle: Battle<T>): Battle<T> {
  if (!battle.history.length) return battle
  const initial: Battle<T> = { entrants: battle.entrants, round: battle.entrants, winners: [], match: 0, history: [], champion: null }
  return battle.history.slice(0, -1).reduce((state, choice) => chooseWinner(state, choice.winner.id, state.history.length), initial)
}

export function roundLabel(size: number): string {
  if (size === 2) return 'Chung kết'
  if (size === 4) return 'Bán kết'
  if (size === 8) return 'Tứ kết'
  return `Vòng ${size} bài`
}

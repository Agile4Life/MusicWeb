/**
 * Resolves with the first non-null result. Rejected tasks and null results are
 * treated as unavailable candidates, so neither can win the race.
 */
export async function firstValidResult<T>(
  tasks: Array<() => Promise<T | null>>,
): Promise<T | null> {
  if (tasks.length === 0) return null

  try {
    return await Promise.any(
      tasks.map(async (task) => {
        const result = await task()
        if (result === null) throw new Error('Candidate returned no result')
        return result
      }),
    )
  } catch {
    return null
  }
}

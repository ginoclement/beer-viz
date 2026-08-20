import { useEffect, useState } from 'react'
import { AGGREGATES, type Aggregates } from '../lib/ingredients'
import { fetchAggregates } from '../lib/api'
import { useApiLive } from './useApiLive'

/**
 * Ingredient rollups: the bundled aggregates.json immediately, upgraded to
 * the API host's live /aggregates once it answers — so the Ingredients tab
 * reflects the host's current crawl instead of the snapshot committed to
 * the repo at build time. Cached module-wide; falls back silently.
 */
let live: Aggregates | null = null

export function useAggregates(): Aggregates {
  const apiLive = useApiLive()
  const [agg, setAgg] = useState<Aggregates>(live ?? AGGREGATES)

  useEffect(() => {
    if (!apiLive || live) return
    let ok = true
    fetchAggregates()
      .then((a) => {
        const cand = a as unknown as Aggregates
        if (ok && cand && typeof cand.totalRecipes === 'number' && cand.byFamily) {
          // an API host built before newer rollups existed may lack fields
          // (e.g. insights) — keep the bundled values for whatever's missing
          live = { ...AGGREGATES, ...cand }
          setAgg(live)
        }
      })
      .catch(() => {})
    return () => {
      ok = false
    }
  }, [apiLive])

  return agg
}

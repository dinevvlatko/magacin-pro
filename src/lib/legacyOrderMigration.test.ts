import { describe, expect, it } from 'vitest'
import { buildLegacyOrderItems, itemPieceCount, legacyOrderTotals } from './legacyOrderMigration'

describe('legacy order migration', () => {
  it('maps the flattened legacy columns into order_items rows without losing data', () => {
    const migration = buildLegacyOrderItems({
      qty025: 2,
      qty025Pieces: 4,
      free025: 1,
      free025Pieces: 3,
      qty15: 1,
      qty15Pieces: 2,
      free15: 1,
      free15Pieces: 0,
      flyers: 5,
    })

    expect(migration).toEqual([
      {
        productCode: 'p025',
        packages: 2,
        pieces: 4,
        freePackages: 1,
        freePieces: 3,
      },
      {
        productCode: 'p15',
        packages: 1,
        pieces: 2,
        freePackages: 1,
        freePieces: 0,
      },
      {
        productCode: 'flyers',
        packages: 0,
        pieces: 5,
        freePackages: 0,
        freePieces: 0,
      },
    ])
  })

  it('skips rows that only contain zero legacy quantities', () => {
    const migration = buildLegacyOrderItems({
      qty025: 0,
      qty025Pieces: 0,
      free025: 0,
      free025Pieces: 0,
      qty15: 0,
      qty15Pieces: 0,
      free15: 0,
      free15Pieces: 0,
      flyers: 0,
    })

    expect(migration).toEqual([])
  })

  it('produces a stable mapping for repeated execution of the same legacy order', () => {
    const order = {
      qty025: 2,
      qty025Pieces: 4,
      free025: 1,
      free025Pieces: 3,
      qty15: 1,
      qty15Pieces: 2,
      free15: 1,
      free15Pieces: 0,
      flyers: 5,
    }

    expect(buildLegacyOrderItems(order)).toEqual(buildLegacyOrderItems(order))
  })

  it('uses 15 pieces per 0.250 package and 6 per BiB package when computing totals', () => {
    const p025 = { productCode: 'p025' as const, packages: 2, pieces: 4, freePackages: 1, freePieces: 3 }
    const p15 = { productCode: 'p15' as const, packages: 1, pieces: 2, freePackages: 1, freePieces: 0 }

    expect(itemPieceCount(p025)).toBe(2 * 15 + 4 + 1 * 15 + 3)
    expect(itemPieceCount(p15)).toBe(1 * 6 + 2 + 1 * 6 + 0)
  })

  it('tracks legacy totals by product code for migration verification', () => {
    const totals = legacyOrderTotals({
      qty025: 2,
      qty025Pieces: 4,
      free025: 1,
      free025Pieces: 3,
      qty15: 1,
      qty15Pieces: 2,
      free15: 1,
      free15Pieces: 0,
      flyers: 5,
    })

    expect(totals).toEqual({ p025: 52, p15: 14, flyers: 5 })
  })
})

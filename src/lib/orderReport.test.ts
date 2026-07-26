import { describe, expect, it } from 'vitest'
import type { Order } from '../types'
import { orderReportTotals } from './orderReport'

const order = (overrides: Partial<Order>): Order => ({
  id: crypto.randomUUID(),
  number: 'PG-2026-0001',
  client: 'Тест клиент',
  city: 'Скопје',
  date: '2026-07-24',
  qty025: 0,
  qty15: 0,
  free025: 0,
  free15: 0,
  flyers: 0,
  note: '',
  status: 'Нова',
  packed: { regular025: false, bib15: false, free025: false, free15: false, flyers: false },
  stockDeducted: false,
  ...overrides,
})

describe('orderReportTotals', () => {
  it('ги собира редовните и гратис количини од сите селектирани нарачки', () => {
    const totals = orderReportTotals([
      order({ qty025: 10, qty025Pieces: 2, free025: 1, qty15: 3, free15: 1, flyers: 100 }),
      order({ qty025: 5, free025: 2, free025Pieces: 4, qty15: 2, qty15Pieces: 1, flyers: 50 }),
    ])

    expect(totals).toEqual({
      p025Packages: 18,
      p025Pieces: 6,
      p15Packages: 6,
      p15Pieces: 1,
      flyers: 150,
    })
  })

  it('враќа нули кога нема селектирани нарачки', () => {
    expect(orderReportTotals([])).toEqual({
      p025Packages: 0,
      p025Pieces: 0,
      p15Packages: 0,
      p15Pieces: 0,
      flyers: 0,
    })
  })
})

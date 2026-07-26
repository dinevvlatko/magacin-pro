import { describe, expect, it } from 'vitest'
import type { AppState, Order } from '../types'
import { buildReportSnapshot, productTotalsSummary, summarizeClientTotals } from './reportEngine'

const order=(id:string,number:string,client:string,city:string,status:Order['status'],qty025=1,free025=0,qty15=0,free15=0,flyers=0):Order=>({
  id,
  number,
  client,
  city,
  date: '2026-07-24',
  qty025,
  qty025Pieces: 0,
  qty15,
  qty15Pieces: 0,
  free025,
  free025Pieces: 0,
  free15,
  free15Pieces: 0,
  flyers,
  note: '',
  status,
  packed: { regular025: false, bib15: false, free025: false, free15: false, flyers: false },
  stockDeducted: status === 'Спакувана' || status === 'Излезена' || status === 'Испратена' || status === 'Доставена',
})

const state=(orders: Order[]): AppState => ({
  warehouse: {
    p025: { packages: 10, pieces: 0, total: 150, perPackage: 15 },
    p15: { packages: 10, pieces: 0, total: 60, perPackage: 6 },
    flyers: 50,
  },
  orders,
  clients: [],
  movements: [],
})

describe('report engine', () => {
  it('filters by status and only counts new/prep orders as reserved', () => {
    const base = state([
      order('o1', 'PG-2026-0001', 'Клиент 1', 'Скопје', 'Нова', 2),
      order('o2', 'PG-2026-0002', 'Клиент 2', 'Битола', 'Во подготовка', 1),
      order('o3', 'PG-2026-0003', 'Клиент 1', 'Скопје', 'Спакувана', 1),
      order('o4', 'PG-2026-0004', 'Клиент 1', 'Скопје', 'Чека залиха', 3),
    ])

    const snapshot = buildReportSnapshot(base, { status: 'all' })
    expect(snapshot.reserved.p025).toBe(45)
    expect(snapshot.ordered.p025).toBe(60)
    expect(snapshot.issued.p025).toBe(15)
  })

  it('keeps product totals stable per product and free quantities', () => {
    const base = state([
      order('o1', 'PG-2026-0001', 'Клиент 1', 'Скопје', 'Нова', 2, 1),
      order('o2', 'PG-2026-0002', 'Клиент 2', 'Битола', 'Спакувана', 1, 0, 1, 1),
    ])

    const totals = productTotalsSummary(base)
    expect(totals.p025.ordered).toBe(45)
    expect(totals.p025.free).toBe(15)
    expect(totals.p15.ordered).toBe(12)
  })

  it('summarizes client volume without double-counting one order', () => {
    const base = state([
      order('o1', 'PG-2026-0001', 'Клиент 1', 'Скопје', 'Доставена', 2),
      order('o2', 'PG-2026-0002', 'Клиент 1', 'Скопје', 'Нова', 1),
    ])

    const client = summarizeClientTotals(base, 'Клиент 1')
    expect(client.orderCount).toBe(2)
    expect(client.ordered.p025).toBe(45)
  })
})

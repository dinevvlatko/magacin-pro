import { describe, expect, it } from 'vitest'
import type { Movement, Order } from '../types'
import { completedSaleDate, isCompletedSaleOrder, orderHasProduct, orderProductAmount, receiptGroups, receiptProductAmount, reportDateMatches, salesProductSummary } from './reportDocuments'

const order: Order = {
  id: 'order-1',
  number: 'PG-2026-0001',
  client: 'Клиент',
  city: 'Скопје',
  date: '2026-10-04',
  qty025: 2,
  qty025Pieces: 4,
  qty15: 1,
  qty15Pieces: 2,
  free025: 1,
  free025Pieces: 1,
  free15: 1,
  free15Pieces: 0,
  flyers: 100,
  note: '',
  status: 'Спакувана',
  packed: { regular025: true, bib15: true, free025: true, free15: true, flyers: true },
  stockDeducted: true,
}

const movement = (id: string, product: Movement['product'], packages: number, pieces: number): Movement => ({
  id,
  date: '2026-10-04',
  product,
  type: 'Влез',
  packages,
  pieces,
  party: 'Прва смена',
  orderNumber: 'PR-0007',
  note: 'Прием',
})

describe('report documents', () => {
  it('calculates regular, free and extra pieces as one product quantity', () => {
    expect(orderProductAmount(order, 'p025')).toEqual({ packages: 3, pieces: 5, units: 50 })
    expect(orderProductAmount(order, 'p15')).toEqual({ packages: 2, pieces: 2, units: 14 })
  })

  it('detects whether an order contains the selected product', () => {
    expect(orderHasProduct(order, 'p025')).toBe(true)
    expect(orderHasProduct({ ...order, flyers: 0 }, 'flyers')).toBe(false)
  })

  it('groups all receipt items under one sequential receipt number', () => {
    const receipts = receiptGroups([
      movement('line-1', 'p025', 2, 3),
      movement('line-2', 'p15', 1, 0),
    ])

    expect(receipts).toHaveLength(1)
    expect(receipts[0].number).toBe('PR-0007')
    expect(receipts[0].lines).toHaveLength(2)
    expect(receiptProductAmount(receipts[0], 'p025')).toEqual({ packages: 2, pieces: 3, units: 33 })
  })

  it('filters documents by an inclusive custom date range', () => {
    expect(reportDateMatches('2026-07-14', 'custom', '2026-07-14', '2026-07-31')).toBe(true)
    expect(reportDateMatches('2026-07-14', 'custom', '2026-07-15', '2026-07-31')).toBe(false)
    expect(reportDateMatches('2026-10-04', 'month', '', '', new Date(2026, 9, 4))).toBe(true)
  })

  it('counts only delivered orders as completed sales and separates free quantities', () => {
    const delivered = { ...order, id: 'delivered', status: 'Доставена' as const, deliveredAt: '2026-10-09' }
    const packed = { ...order, id: 'packed', status: 'Спакувана' as const }

    expect(isCompletedSaleOrder(delivered)).toBe(true)
    expect(isCompletedSaleOrder(packed)).toBe(false)
    expect(completedSaleDate(delivered)).toBe('2026-10-09')
    expect(completedSaleDate({ ...delivered, deliveredAt: undefined })).toBe(order.date)
    expect(salesProductSummary([delivered, packed], 'p025')).toEqual({
      regular: { packages: 2, pieces: 4, units: 34 },
      free: { packages: 1, pieces: 1, units: 16 },
      total: { packages: 3, pieces: 5, units: 50 },
    })
    expect(salesProductSummary([delivered, packed], 'p15')).toEqual({
      regular: { packages: 1, pieces: 2, units: 8 },
      free: { packages: 1, pieces: 0, units: 6 },
      total: { packages: 2, pieces: 2, units: 14 },
    })
  })
})

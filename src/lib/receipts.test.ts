import { describe, expect, it } from 'vitest'
import {
  applyWarehouseDeltasAtomically,
  receiptItemDeltas,
  receiptItemUnits,
  ReceiptValidationError,
  validateReceiptItems,
  type ProductRecord,
  type ReceiptItemDraft,
} from './receipts'

const products: ProductRecord[] = [
  { id: 'p025-id', code: 'p025', name: 'Шише 0.250 мл', package_size: 15, stock_units: 150, active: true },
  { id: 'p15-id', code: 'p15', name: 'БиБ 1,5 Л', package_size: 6, stock_units: 60, active: true },
  { id: 'flyers-id', code: 'flyers', name: 'Флаери', package_size: 1, stock_units: 100, active: true },
]

const item = (overrides: Partial<ReceiptItemDraft>): ReceiptItemDraft => ({
  id: crypto.randomUUID(),
  productId: 'p025-id',
  packages: 0,
  extraPieces: 0,
  ...overrides,
})

describe('receipt items', () => {
  it('поддржува повеќе различни ставки', () => {
    expect(() => validateReceiptItems([
      item({ productId: 'p025-id', packages: 2 }),
      item({ productId: 'p15-id', packages: 3 }),
      item({ productId: 'flyers-id', extraPieces: 50 }),
    ], products)).not.toThrow()
  })

  it('одбива duplicate product', () => {
    expect(() => validateReceiptItems([
      item({ productId: 'p025-id', packages: 1 }),
      item({ productId: 'p025-id', packages: 2 }),
    ], products)).toThrow('Истиот производ не може да биде внесен двапати.')
  })

  it('одбива празна приемница и приемница со нулти количини', () => {
    expect(() => validateReceiptItems([], products)).toThrow(ReceiptValidationError)
    expect(() => validateReceiptItems([item({})], products)).toThrow('Најмалку една ставка')
  })

  it('користи package_size 15 за p025', () => {
    expect(receiptItemUnits(item({ packages: 2, extraPieces: 4 }), 15)).toBe(34)
  })

  it('користи package_size 6 за p15', () => {
    expect(receiptItemUnits(item({ productId: 'p15-id', packages: 3, extraPieces: 2 }), 6)).toBe(20)
  })

  it('при edit пресметува само разлика стара/нова количина', () => {
    const deltas = receiptItemDeltas(
      [item({ productId: 'p025-id', packages: 10 }), item({ productId: 'p15-id', packages: 4 })],
      [item({ productId: 'p025-id', packages: 12 }), item({ productId: 'p15-id', packages: 3 })],
      products,
    )
    expect(deltas).toEqual({ 'p025-id': 30, 'p15-id': -6 })
  })

  it('atomic rollback не го менува оригиналниот warehouse ако една ставка не успее', () => {
    const original = { 'p025-id': 100, 'p15-id': 5 }
    expect(() => applyWarehouseDeltasAtomically(original, { 'p025-id': 20, 'p15-id': -6 })).toThrow('негативна залиха')
    expect(original).toEqual({ 'p025-id': 100, 'p15-id': 5 })
  })
})

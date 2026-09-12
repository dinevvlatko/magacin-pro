import { describe, expect, it } from 'vitest'
import type { AppState, Order, Movement } from '../types'
import {
  available,
  canReserveOrder,
  calculateWarehouseSnapshot,
  changeOrderStatus,
  createOrderWithReservation,
  getItemQuantity,
  getProductPackageSize,
  hydrateState,
  normalizeWarehouseTotals,
} from './logic'

const makeOrder = (overrides: Partial<Order> = {}): Order => ({
  id: overrides.id ?? 'order-1',
  number: overrides.number ?? 'PG-2026-0001',
  client: overrides.client ?? 'Клиент',
  city: overrides.city ?? 'Скопје',
  date: overrides.date ?? '2026-07-24',
  qty025: overrides.qty025 ?? 0,
  qty025Pieces: overrides.qty025Pieces ?? 0,
  qty15: overrides.qty15 ?? 0,
  qty15Pieces: overrides.qty15Pieces ?? 0,
  free025: overrides.free025 ?? 0,
  free025Pieces: overrides.free025Pieces ?? 0,
  free15: overrides.free15 ?? 0,
  free15Pieces: overrides.free15Pieces ?? 0,
  flyers: overrides.flyers ?? 0,
  note: overrides.note ?? '',
  status: overrides.status ?? 'Нова',
  packed: overrides.packed ?? { regular025: false, bib15: false, free025: false, free15: false, flyers: false },
  stockDeducted: overrides.stockDeducted ?? false,
})

const makeMovement = (overrides: Partial<Movement> = {}): Movement => ({
  id: overrides.id ?? 'movement-1',
  date: overrides.date ?? '2026-07-24',
  product: overrides.product ?? 'p025',
  type: overrides.type ?? 'Влез',
  packages: overrides.packages ?? 0,
  pieces: overrides.pieces ?? 0,
  party: overrides.party ?? 'Тим',
  orderNumber: overrides.orderNumber ?? '',
  note: overrides.note ?? '',
})

describe('warehouse engine', () => {
  it('uses the fixed package sizes for all products', () => {
    expect(getProductPackageSize('p025')).toBe(15)
    expect(getProductPackageSize('p15')).toBe(6)
    expect(getProductPackageSize('flyers')).toBe(1)
  })

  it('calculates item totals with regular and free quantities', () => {
    expect(getItemQuantity('p025', { packages: 2, pieces: 4, freePackages: 1, freePieces: 3 })).toEqual(2 * 15 + 4 + 1 * 15 + 3)
    expect(getItemQuantity('p15', { packages: 1, pieces: 2, freePackages: 1, freePieces: 0 })).toEqual(1 * 6 + 2 + 1 * 6 + 0)
    expect(getItemQuantity('flyers', { packages: 0, pieces: 5, freePackages: 0, freePieces: 0 })).toEqual(5)
  })

  it('reserves only new and in-progress orders, and leaves waiting orders unreserved', () => {
    const state: AppState = {
      warehouse: {
        p025: { packages: 10, pieces: 0, total: 150, perPackage: 15 },
        p15: { packages: 10, pieces: 0, total: 60, perPackage: 6 },
        flyers: 50,
      },
      orders: [
        makeOrder({ id: 'waiting', number: 'PG-2026-0002', status: 'Чека залиха', qty025: 2 }),
        makeOrder({ id: 'new', number: 'PG-2026-0003', status: 'Нова', qty025: 2 }),
        makeOrder({ id: 'prep', number: 'PG-2026-0004', status: 'Во подготовка', qty025: 2 }),
      ],
      clients: [],
      movements: [],
    }

    const snapshot = calculateWarehouseSnapshot(state)

    expect(snapshot.reserved_stock.p025).toBe(60)
    expect(snapshot.available_stock.p025).toBe(90)
  })

  it('deducts an order stock exactly once when it becomes packed', () => {
    const state: AppState = {
      warehouse: {
        p025: { packages: 10, pieces: 0, total: 150, perPackage: 15 },
        p15: { packages: 10, pieces: 0, total: 60, perPackage: 6 },
        flyers: 50,
      },
      orders: [makeOrder({ id: 'packed', status: 'Нова', qty025: 2, packed: { regular025: true, bib15: true, free025: true, free15: true, flyers: true } })],
      clients: [],
      movements: [],
    }

    const next = changeOrderStatus(state, state.orders[0], 'Спакувана')
    expect(next?.orders[0].stockDeducted).toBe(true)
    expect(next?.warehouse.p025.total).toBe(120)
  })

  it('keeps sent-to-delivered as status-only without changing warehouse', () => {
    const state: AppState = {
      warehouse: {
        p025: { packages: 10, pieces: 0, total: 150, perPackage: 15 },
        p15: { packages: 10, pieces: 0, total: 60, perPackage: 6 },
        flyers: 50,
      },
      orders: [makeOrder({ id: 'sent', status: 'Испратена', qty025: 2, stockDeducted: true })],
      clients: [],
      movements: [],
    }

    const next = changeOrderStatus(state, state.orders[0], 'Доставена')
    expect(next?.orders[0].status).toBe('Доставена')
    expect(next?.warehouse.p025.total).toBe(150)
  })

  it('hydrates old deducted statuses without subtracting stock again', () => {
    const state: AppState = {
      warehouse: {
        p025: { packages: 10, pieces: 0, total: 150, perPackage: 15 },
        p15: { packages: 10, pieces: 0, total: 60, perPackage: 6 },
        flyers: 50,
      },
      orders: [makeOrder({ id: 'legacy', status: 'Испратена', qty025: 2, stockDeducted: false })],
      clients: [],
      movements: [],
    }

    const next = normalizeWarehouseTotals(state)
    const order = next.orders[0]

    expect(order.stockDeducted).toBe(true)
    expect(next.warehouse.p025.total).toBe(150)
  })

  it('keeps the stored warehouse total as the physical stock and uses receipts only as an audit trail', () => {
    const state: AppState = {
      warehouse: {
        p025: { packages: 10, pieces: 0, total: 150, perPackage: 15 },
        p15: { packages: 10, pieces: 0, total: 60, perPackage: 6 },
        flyers: 50,
      },
      orders: [],
      clients: [],
      movements: [makeMovement({ id: 'move-1', product: 'p025', type: 'Влез', packages: 1, pieces: 0, orderNumber: 'PR-0001' })],
    }

    const snapshot = calculateWarehouseSnapshot(state)
    expect(snapshot.physical_stock.p025).toBe(150)
    expect(snapshot.received_stock.p025).toBe(15)
  })

  it('keeps audit movement statistics separate from the physical and reserved stock', () => {
    const state: AppState = {
      warehouse: {
        p025: { packages: 10, pieces: 0, total: 150, perPackage: 15 },
        p15: { packages: 10, pieces: 0, total: 60, perPackage: 6 },
        flyers: 50,
      },
      orders: [makeOrder({ id: 'reserved', status: 'Нова', qty025: 2 })],
      clients: [],
      movements: [
        makeMovement({ id: 'in', product: 'p025', type: 'Влез', packages: 1 }),
        makeMovement({ id: 'packed', product: 'p025', type: 'Излез', packages: 2, note: 'Автоматско одземање при пакување' }),
        makeMovement({ id: 'manual-out', product: 'p15', type: 'Излез', packages: 3, note: 'Испорака без нарачка' }),
        makeMovement({ id: 'returned', product: 'p15', type: 'Враќање', packages: 1 }),
      ],
    }

    const snapshot = calculateWarehouseSnapshot(state)
    expect(snapshot.physical_stock).toEqual({ p025: 150, p15: 60, flyers: 50 })
    expect(snapshot.reserved_stock.p025).toBe(30)
    expect(snapshot.available_stock.p025).toBe(120)
    expect(snapshot.received_stock.p025).toBe(15)
    expect(snapshot.automatic_packed_stock.p025).toBe(30)
    expect(snapshot.manual_outbound_stock.p15).toBe(18)
    expect(snapshot.reconciled_outbound_stock).toEqual({ p025: 0, p15: 0, flyers: 0 })
    expect(snapshot.returned_stock.p15).toBe(6)
  })

  it('does not subtract an already recorded packing movement twice when reserving exact stock', () => {
    const packedOrder = makeOrder({ id: 'packed', number: 'PG-2026-0001', status: 'Спакувана', stockDeducted: true, qty025: 30 })
    const firstOrder = makeOrder({ id: 'first', number: 'PG-2026-0002', status: 'Нова', qty025: 100 })
    const waitingOrder = makeOrder({ id: 'waiting', number: 'PG-2026-0003', status: 'Чека залиха', qty025: 113 })
    const state: AppState = {
      warehouse: {
        p025: { packages: 213, pieces: 0, total: 3195, perPackage: 15 },
        p15: { packages: 10, pieces: 0, total: 60, perPackage: 6 },
        flyers: 50,
      },
      orders: [packedOrder, firstOrder, waitingOrder],
      clients: [],
      movements: [makeMovement({ product: 'p025', type: 'Излез', packages: 30, pieces: 0, orderNumber: packedOrder.number, note: 'Автоматско одземање при пакување' })],
    }

    const snapshot = calculateWarehouseSnapshot(state)
    expect(snapshot.physical_stock.p025).toBe(3195)
    expect(snapshot.reserved_stock.p025).toBe(1500)
    expect(snapshot.available_stock.p025).toBe(1695)
    expect(canReserveOrder(state, waitingOrder)).toBe(true)

    const hydrated = hydrateState(state)
    expect(hydrated.orders.find(order => order.id === 'waiting')?.status).toBe('Нова')
    expect(available(hydrated).p025).toBe(0)
  })

  it('keeps all 26 BiB packages available when their historical packing movement was already deducted', () => {
    const packedOrder = makeOrder({ id: 'packed-bib', number: 'PG-2026-0004', status: 'Спакувана', stockDeducted: true, qty15: 10 })
    const firstOrder = makeOrder({ id: 'first-bib', number: 'PG-2026-0005', status: 'Нова', qty15: 13 })
    const waitingOrder = makeOrder({ id: 'waiting-bib', number: 'PG-2026-0006', status: 'Чека залиха', qty15: 13 })
    const state: AppState = {
      warehouse: {
        p025: { packages: 0, pieces: 0, total: 0, perPackage: 15 },
        p15: { packages: 26, pieces: 0, total: 156, perPackage: 6 },
        flyers: 0,
      },
      orders: [packedOrder, firstOrder, waitingOrder],
      clients: [],
      movements: [makeMovement({ product: 'p15', type: 'Излез', packages: 10, pieces: 0, orderNumber: packedOrder.number, note: 'Автоматско одземање при пакување' })],
    }

    const snapshot = calculateWarehouseSnapshot(state)
    expect(snapshot.physical_stock.p15).toBe(156)
    expect(snapshot.reserved_stock.p15).toBe(78)
    expect(snapshot.available_stock.p15).toBe(78)
    expect(canReserveOrder(state, waitingOrder)).toBe(true)

    const hydrated = hydrateState(state)
    expect(hydrated.orders.find(order => order.id === 'waiting-bib')?.status).toBe('Нова')
    expect(available(hydrated).p15).toBe(0)
  })

  it('reserves the two exact Skopje orders against the latest warehouse state', () => {
    const state: AppState = {
      warehouse: {
        p025: { packages: 213, pieces: 0, total: 3195, perPackage: 15 },
        p15: { packages: 26, pieces: 0, total: 156, perPackage: 6 },
        flyers: 0,
      },
      orders: [],
      clients: [],
      movements: [],
    }
    const first = makeOrder({ id: 'skopje-1', number: 'PG-2026-0101', client: 'Скопје 1', city: 'Скопје', qty025: 113, qty15: 26 })
    const savedFirst = createOrderWithReservation(state, first)
    const withFirst = { ...state, orders: [savedFirst] }
    const second = makeOrder({ id: 'skopje-2', number: 'PG-2026-0102', client: 'Скопје 2', city: 'Скопје', qty025: 100 })
    const savedSecond = createOrderWithReservation(withFirst, second)
    const complete = { ...withFirst, orders: [savedSecond, ...withFirst.orders] }

    expect(savedFirst.status).toBe('Нова')
    expect(savedSecond.status).toBe('Нова')
    expect(available(complete)).toEqual({ p025: 0, p15: 0, flyers: 0 })
  })

  it('packs the two exact Skopje orders and leaves the warehouse empty', () => {
    const first = makeOrder({ id: 'skopje-pack-1', number: 'PG-2026-0101', client: 'Скопје 1', city: 'Скопје', qty025: 113, qty15: 26, packed: { regular025: true, bib15: true, free025: true, free15: true, flyers: true } })
    const second = makeOrder({ id: 'skopje-pack-2', number: 'PG-2026-0102', client: 'Скопје 2', city: 'Скопје', qty025: 100, packed: { regular025: true, bib15: true, free025: true, free15: true, flyers: true } })
    const state: AppState = {
      warehouse: {
        p025: { packages: 213, pieces: 0, total: 3195, perPackage: 15 },
        p15: { packages: 26, pieces: 0, total: 156, perPackage: 6 },
        flyers: 0,
      },
      orders: [first, second],
      clients: [],
      movements: [],
    }

    const firstPacked = changeOrderStatus(state, first, 'Спакувана')
    expect(firstPacked?.orders.find(order => order.id === first.id)?.status).toBe('Спакувана')
    expect(firstPacked?.warehouse.p025.total).toBe(1500)
    expect(firstPacked?.warehouse.p15.total).toBe(0)

    const secondPacked = changeOrderStatus(firstPacked!, firstPacked!.orders.find(order => order.id === second.id)!, 'Спакувана')
    expect(secondPacked?.orders.every(order => order.status === 'Спакувана')).toBe(true)
    expect(secondPacked?.warehouse.p025.total).toBe(0)
    expect(secondPacked?.warehouse.p15.total).toBe(0)
    expect(available(secondPacked!)).toEqual({ p025: 0, p15: 0, flyers: 0 })
  })

  it('keeps the warehouse empty while packed orders move through sent and delivered', () => {
    const order = makeOrder({ id: 'status-chain', status: 'Спакувана', qty025: 113, qty15: 26, stockDeducted: true })
    const state: AppState = {
      warehouse: {
        p025: { packages: 0, pieces: 0, total: 0, perPackage: 15 },
        p15: { packages: 0, pieces: 0, total: 0, perPackage: 6 },
        flyers: 0,
      },
      orders: [order],
      clients: [],
      movements: [],
    }

    const sent = changeOrderStatus(state, order, 'Испратена')!
    const delivered = changeOrderStatus(sent, sent.orders[0], 'Доставена')!

    expect(sent.warehouse).toEqual(state.warehouse)
    expect(delivered.warehouse).toEqual(state.warehouse)
    expect(delivered.orders[0]).toMatchObject({ status: 'Доставена', stockDeducted: true })
    expect(delivered.movements).toHaveLength(0)
  })

  it('does not consume a new receipt to retry an older status repair', () => {
    const oldOrder = makeOrder({ id: 'old-delivered', number: 'PG-2026-0004', status: 'Доставена', qty025: 50, stockDeducted: true })
    const state: AppState = {
      warehouse: {
        p025: { packages: 85, pieces: 0, total: 1275, perPackage: 15 },
        p15: { packages: 0, pieces: 0, total: 0, perPackage: 6 },
        flyers: 0,
      },
      orders: [oldOrder],
      clients: [],
      movements: [
        makeMovement({ id: 'latest-receipt', product: 'p025', type: 'Влез', packages: 85, orderNumber: 'PR-0002' }),
        makeMovement({ id: 'old-out', product: 'p025', type: 'Излез', packages: 50, orderNumber: oldOrder.number, note: 'Автоматско одземање при пакување' }),
        makeMovement({ id: 'old-return', product: 'p025', type: 'Враќање', packages: 50, orderNumber: oldOrder.number, note: 'Автоматско враќање при откажување' }),
      ],
    }

    const hydrated = hydrateState(state)

    expect(hydrated.warehouse.p025).toMatchObject({ total: 1275, packages: 85, pieces: 0 })
    expect(hydrated.movements.some(movement => movement.note.startsWith('Корекција: повторно одземање'))).toBe(false)
  })

  it('returns the deferred 50-package correction that reduced an 85-package receipt to 35', () => {
    const oldOrder = makeOrder({ id: 'old-delivered', number: 'PG-2026-0004', status: 'Доставена', qty025: 50, stockDeducted: true })
    const state: AppState = {
      warehouse: {
        p025: { packages: 35, pieces: 0, total: 525, perPackage: 15 },
        p15: { packages: 0, pieces: 0, total: 0, perPackage: 6 },
        flyers: 0,
      },
      orders: [oldOrder],
      clients: [],
      movements: [
        makeMovement({ id: 'latest-receipt', product: 'p025', type: 'Влез', packages: 85, orderNumber: 'PR-0002' }),
        makeMovement({ id: 'earlier-valid-repair', product: 'p025', type: 'Излез', packages: 100, orderNumber: 'PG-2026-0102', note: 'Корекција: повторно одземање по погрешно враќање при промена на статус' }),
        makeMovement({ id: 'old-packing', product: 'p025', type: 'Излез', packages: 50, orderNumber: oldOrder.number, note: 'Автоматско одземање при пакување' }),
        makeMovement({ id: 'old-incorrect-return', product: 'p025', type: 'Враќање', packages: 50, orderNumber: oldOrder.number, note: 'Автоматско враќање при откажување' }),
        makeMovement({ id: 'deferred-repair', product: 'p025', type: 'Излез', packages: 50, orderNumber: oldOrder.number, note: 'Корекција: повторно одземање по погрешно враќање при промена на статус' }),
      ],
    }

    const repaired = hydrateState(state)
    const repairedAgain = hydrateState(repaired)

    expect(repaired.warehouse.p025).toMatchObject({ total: 1275, packages: 85, pieces: 0 })
    expect(repaired.movements.filter(movement => movement.orderNumber === oldOrder.number)).toEqual([
      expect.objectContaining({ id: 'old-packing', type: 'Излез', packages: 50 }),
    ])
    expect(repaired.movements.some(movement => movement.id === 'deferred-repair-reversal-deferred-repair')).toBe(false)
    expect(repairedAgain.warehouse).toEqual(repaired.warehouse)
    expect(repairedAgain.movements).toHaveLength(repaired.movements.length)
  })

  it('does not double-count stock when an order is cancelled twice', () => {
    const state: AppState = {
      warehouse: {
        p025: { packages: 10, pieces: 0, total: 150, perPackage: 15 },
        p15: { packages: 10, pieces: 0, total: 60, perPackage: 6 },
        flyers: 50,
      },
      orders: [makeOrder({ id: 'cancel', status: 'Спакувана', qty025: 2, stockDeducted: true })],
      clients: [],
      movements: [],
    }

    const first = changeOrderStatus(state, state.orders[0], 'Откажана')
    const second = changeOrderStatus(first!, first!.orders[0], 'Откажана')

    expect(first?.warehouse.p025.total).toBe(180)
    expect(second?.warehouse.p025.total).toBe(180)
  })
})

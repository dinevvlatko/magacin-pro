import type { AppState, Movement, Order, OrderStatus, ProductKey } from '../types'
import { activeStatuses, getItemQuantity, getProductPackageSize, orderPieces, reservingStatuses } from './logic'

export type ReportFilter = {
  dateFrom?: string
  dateTo?: string
  period?: 'day' | 'week' | 'month' | 'year' | 'all'
  client?: string
  city?: string
  status?: OrderStatus | 'all' | 'active'
  product?: ProductKey | 'all'
  freeMode?: 'all' | 'regular' | 'free'
  orderNumber?: string
  user?: string
  documentType?: string
  movementType?: string
}

export type ReportSnapshot = {
  ordered: Record<ProductKey, number>
  reserved: Record<ProductKey, number>
  issued: Record<ProductKey, number>
  delivered: Record<ProductKey, number>
  free: Record<ProductKey, number>
  received: Record<ProductKey, number>
  returned: Record<ProductKey, number>
  damaged: Record<ProductKey, number>
  positiveCorrections: Record<ProductKey, number>
  negativeCorrections: Record<ProductKey, number>
  difference: Record<ProductKey, number>
  physicalStock: Record<ProductKey, number>
  availableStock: Record<ProductKey, number>
}

const emptyRecord = (): Record<ProductKey, number> => ({ p025: 0, p15: 0, flyers: 0 })

const movementQuantity = (movement: Movement): number => {
  if (movement.product === 'p025') return movement.packages * getProductPackageSize('p025') + movement.pieces
  if (movement.product === 'p15') return movement.packages * getProductPackageSize('p15') + movement.pieces
  return movement.pieces
}

const orderRegular = (order: Order, product: ProductKey): number => {
  if (product === 'p025') {
    return getItemQuantity('p025', {
      packages: order.qty025,
      pieces: order.qty025Pieces ?? 0,
      freePackages: 0,
      freePieces: 0,
    })
  }
  if (product === 'p15') {
    return getItemQuantity('p15', {
      packages: order.qty15,
      pieces: order.qty15Pieces ?? 0,
      freePackages: 0,
      freePieces: 0,
    })
  }
  return order.flyers
}

const orderFree = (order: Order, product: ProductKey): number => {
  if (product === 'p025') {
    return getItemQuantity('p025', {
      packages: 0,
      pieces: 0,
      freePackages: order.free025,
      freePieces: order.free025Pieces ?? 0,
    })
  }
  if (product === 'p15') {
    return getItemQuantity('p15', {
      packages: 0,
      pieces: 0,
      freePackages: order.free15 ?? 0,
      freePieces: order.free15Pieces ?? 0,
    })
  }
  return 0
}

const productTotalsByOrder = (order: Order): Record<ProductKey, number> => {
  const totals = orderPieces(order)
  return {
    p025: totals.p025,
    p15: totals.p15,
    flyers: totals.flyers,
  }
}

const freeQuantityByOrder = (order: Order, product: ProductKey): number => {
  if (product === 'p025') return getItemQuantity('p025', { packages: 0, pieces: 0, freePackages: order.free025, freePieces: order.free025Pieces ?? 0 })
  if (product === 'p15') return getItemQuantity('p15', { packages: 0, pieces: 0, freePackages: order.free15 ?? 0, freePieces: order.free15Pieces ?? 0 })
  return 0
}

const inPeriod = (date: string, filter: ReportFilter): boolean => {
  if (!filter.period && !filter.dateFrom && !filter.dateTo) return true
  if (filter.dateFrom && date < filter.dateFrom) return false
  if (filter.dateTo && date > filter.dateTo) return false
  if (filter.period === 'day' || filter.period === 'week' || filter.period === 'month' || filter.period === 'year') {
    const current = new Date(date)
    const now = new Date()
    if (filter.period === 'day') return current.toDateString() === now.toDateString()
    if (filter.period === 'week') {
      const start = new Date(now)
      start.setDate(now.getDate() - 6)
      return current >= start && current <= now
    }
    if (filter.period === 'month') return current.getMonth() === now.getMonth() && current.getFullYear() === now.getFullYear()
    if (filter.period === 'year') return current.getFullYear() === now.getFullYear()
  }
  return true
}

const passesClientCityFilters = (order: Order, filter: ReportFilter): boolean => {
  if (filter.client && filter.client !== 'all' && order.client !== filter.client) return false
  if (filter.city && filter.city !== 'all' && order.city !== filter.city) return false
  return true
}

const passesStatusFilter = (order: Order, filter: ReportFilter): boolean => {
  if (filter.status === 'all') return true
  if (filter.status === 'active') return activeStatuses.has(order.status)
  if (filter.status && order.status !== filter.status) return false
  return true
}

const passesProductFilter = (order: Order, filter: ReportFilter): boolean => {
  if (!filter.product || filter.product === 'all') return true
  const totals = productTotalsByOrder(order)
  return totals[filter.product] > 0
}

const passesFreeModeFilter = (order: Order, filter: ReportFilter): boolean => {
  if (!filter.freeMode || filter.freeMode === 'all') return true
  const regular = orderRegular(order, 'p025') + orderRegular(order, 'p15')
  const free = orderFree(order, 'p025') + orderFree(order, 'p15')
  if (filter.freeMode === 'regular') return regular > 0
  if (filter.freeMode === 'free') return free > 0
  return true
}

const passesDocumentFilter = (movement: Movement, filter: ReportFilter): boolean => {
  if (filter.documentType && filter.documentType !== 'all' && !movement.orderNumber.startsWith(filter.documentType)) return false
  return true
}

export const buildReportSnapshot = (state: AppState, filter: ReportFilter = {}): ReportSnapshot => {
  const ordered = emptyRecord()
  const reserved = emptyRecord()
  const issued = emptyRecord()
  const delivered = emptyRecord()
  const free = emptyRecord()
  const received = emptyRecord()
  const returned = emptyRecord()
  const damaged = emptyRecord()
  const positiveCorrections = emptyRecord()
  const negativeCorrections = emptyRecord()

  state.orders.forEach(order => {
    if (!inPeriod(order.date, filter)) return
    if (!passesClientCityFilters(order, filter)) return
    if (!passesStatusFilter(order, filter)) return
    if (!passesProductFilter(order, filter)) return
    if (!passesFreeModeFilter(order, filter)) return

    const totals = orderPieces(order)
    if (order.status !== 'Чека залиха') {
      ordered.p025 += totals.p025
      ordered.p15 += totals.p15
      ordered.flyers += totals.flyers
    }

    if (reservingStatuses.has(order.status)) {
      reserved.p025 += totals.p025
      reserved.p15 += totals.p15
      reserved.flyers += totals.flyers
    }

    if (order.stockDeducted) {
      issued.p025 += totals.p025
      issued.p15 += totals.p15
      issued.flyers += totals.flyers
    }

    if (order.status === 'Доставена') {
      delivered.p025 += totals.p025
      delivered.p15 += totals.p15
      delivered.flyers += totals.flyers
    }

    free.p025 += freeQuantityByOrder(order, 'p025')
    free.p15 += freeQuantityByOrder(order, 'p15')
    free.flyers += 0
  })

  state.movements.forEach(movement => {
    if (!inPeriod(movement.date, filter)) return
    if (!passesDocumentFilter(movement, filter)) return
    if (filter.movementType && filter.movementType !== 'all' && movement.type !== filter.movementType) return

    const qty = movementQuantity(movement)
    const product = movement.product

    if (movement.type === 'Влез') received[product] += qty
    if (movement.type === 'Враќање') returned[product] += qty
    if (movement.type === 'Оштетување') damaged[product] += qty
    if (movement.type === 'Корекција') {
      if (qty >= 0) positiveCorrections[product] += qty
      else negativeCorrections[product] += Math.abs(qty)
    }
  })

  const physicalStock = {
    p025: state.warehouse.p025.total,
    p15: state.warehouse.p15.total,
    flyers: state.warehouse.flyers,
  }
  const availableStock = {
    p025: Math.max(0, physicalStock.p025 - reserved.p025),
    p15: Math.max(0, physicalStock.p15 - reserved.p15),
    flyers: Math.max(0, physicalStock.flyers - reserved.flyers),
  }

  const difference = {
    p025: ordered.p025 - issued.p025,
    p15: ordered.p15 - issued.p15,
    flyers: ordered.flyers - issued.flyers,
  }

  return {
    ordered,
    reserved,
    issued,
    delivered,
    free,
    received,
    returned,
    damaged,
    positiveCorrections,
    negativeCorrections,
    difference,
    physicalStock,
    availableStock,
  }
}

export const productTotalsSummary = (state: AppState): Record<ProductKey, { ordered: number; free: number; reserved: number; issued: number; delivered: number; received: number; damaged: number; corrected: number; physical: number; available: number }> => {
  const filtered = buildReportSnapshot(state)
  return {
    p025: {
      ordered: Math.max(0, filtered.ordered.p025 - filtered.free.p025),
      free: filtered.free.p025,
      reserved: filtered.reserved.p025,
      issued: filtered.issued.p025,
      delivered: filtered.delivered.p025,
      received: filtered.received.p025,
      damaged: filtered.damaged.p025,
      corrected: filtered.positiveCorrections.p025 + filtered.negativeCorrections.p025,
      physical: filtered.physicalStock.p025,
      available: filtered.availableStock.p025,
    },
    p15: {
      ordered: filtered.ordered.p15,
      free: filtered.free.p15,
      reserved: filtered.reserved.p15,
      issued: filtered.issued.p15,
      delivered: filtered.delivered.p15,
      received: filtered.received.p15,
      damaged: filtered.damaged.p15,
      corrected: filtered.positiveCorrections.p15 + filtered.negativeCorrections.p15,
      physical: filtered.physicalStock.p15,
      available: filtered.availableStock.p15,
    },
    flyers: {
      ordered: filtered.ordered.flyers,
      free: filtered.free.flyers,
      reserved: filtered.reserved.flyers,
      issued: filtered.issued.flyers,
      delivered: filtered.delivered.flyers,
      received: filtered.received.flyers,
      damaged: filtered.damaged.flyers,
      corrected: filtered.positiveCorrections.flyers + filtered.negativeCorrections.flyers,
      physical: filtered.physicalStock.flyers,
      available: filtered.availableStock.flyers,
    },
  }
}

export const summarizeClientTotals = (state: AppState, client: string) => {
  const rows = state.orders.filter(order => order.client === client)
  const totals = rows.reduce((sum, order) => {
    const productTotals = orderPieces(order)
    return {
      ordered: sum.ordered + productTotals.p025 + productTotals.p15 + productTotals.flyers,
      issued: sum.issued + (order.stockDeducted ? productTotals.p025 + productTotals.p15 + productTotals.flyers : 0),
      free: sum.free + (order.free025 * 15 + (order.free025Pieces ?? 0) + (order.free15 ?? 0) * 6 + (order.free15Pieces ?? 0)),
      delivered: sum.delivered + (order.status === 'Доставена' ? productTotals.p025 + productTotals.p15 + productTotals.flyers : 0),
      flyers: sum.flyers + order.flyers,
    }
  }, { ordered: 0, issued: 0, free: 0, delivered: 0, flyers: 0 })

  return {
    orderCount: rows.length,
    ordered: { p025: rows.reduce((total, order) => total + orderPieces(order).p025, 0), p15: rows.reduce((total, order) => total + orderPieces(order).p15, 0), flyers: rows.reduce((total, order) => total + order.flyers, 0) },
    issued: { p025: rows.reduce((total, order) => total + (order.stockDeducted ? orderPieces(order).p025 : 0), 0), p15: rows.reduce((total, order) => total + (order.stockDeducted ? orderPieces(order).p15 : 0), 0), flyers: rows.reduce((total, order) => total + (order.stockDeducted ? order.flyers : 0), 0) },
    delivered: { p025: rows.filter(order => order.status === 'Доставена').reduce((total, order) => total + orderPieces(order).p025, 0), p15: rows.filter(order => order.status === 'Доставена').reduce((total, order) => total + orderPieces(order).p15, 0), flyers: rows.filter(order => order.status === 'Доставена').reduce((total, order) => total + order.flyers, 0) },
    free: totals.free,
    lastOrder: rows.toSorted((a, b) => b.date.localeCompare(a.date))[0]?.number ?? null,
    averageOrder: rows.length ? Math.round(totals.ordered / rows.length) : 0,
    activeOrders: rows.filter(order => ['Нова', 'Во подготовка', 'Спакувана'].includes(order.status)).length,
    cancelledOrders: rows.filter(order => order.status === 'Откажана').length,
  }
}

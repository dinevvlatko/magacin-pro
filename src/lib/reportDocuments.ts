import type { Movement, Order, ProductKey } from '../types'
import { getProductPackageSize, orderPieces } from './logic'

export type ReportProduct = ProductKey | 'all'
export type ReportPeriod = 'all' | 'month' | 'year' | 'custom'

export type ReceiptGroup = {
  number: string
  date: string
  lines: Movement[]
  party: string
  note: string
}

export type ProductAmount = {
  packages: number
  pieces: number
  units: number
}

export type ReportPrintDocument = {
  kind: 'dispatch' | 'receipts' | 'sales'
  product: ReportProduct
  periodLabel: string
  generatedAt: string
  orders: Order[]
  receipts: ReceiptGroup[]
}

export const reportProductKeys: ProductKey[] = ['p025', 'p15', 'flyers']

export const reportDateMatches = (
  date: string,
  period: ReportPeriod,
  fromDate = '',
  toDate = '',
  referenceDate = new Date(),
): boolean => {
  if (period === 'all') return true
  if (period === 'custom') return (!fromDate || date >= fromDate) && (!toDate || date <= toDate)
  const year = String(referenceDate.getFullYear())
  if (period === 'year') return date.startsWith(year)
  const month = `${year}-${String(referenceDate.getMonth() + 1).padStart(2, '0')}`
  return date.startsWith(month)
}

export const receiptGroups = (movements: Movement[]): ReceiptGroup[] => {
  const groups = new Map<string, Movement[]>()
  movements
    .filter(movement => movement.type === 'Влез' && /^PR-\d{4}$/.test(movement.orderNumber))
    .forEach(movement => groups.set(movement.orderNumber, [...(groups.get(movement.orderNumber) || []), movement]))

  return [...groups]
    .map(([number, lines]) => ({
      number,
      date: lines[0].date,
      lines,
      party: lines.map(line => line.party).find(Boolean) || '',
      note: lines.map(line => line.note).find(Boolean) || '',
    }))
    .sort((a, b) => Number(b.number.slice(3)) - Number(a.number.slice(3)))
}

export const selectedReportProducts = (product: ReportProduct): ProductKey[] =>
  product === 'all' ? reportProductKeys : [product]

const amountFromUnits = (product: ProductKey, units: number): ProductAmount => {
  if (product === 'flyers') return { packages: 0, pieces: units, units }
  const packageSize = getProductPackageSize(product)
  return {
    packages: Math.floor(units / packageSize),
    pieces: units % packageSize,
    units,
  }
}

export const productAmountFromUnits = (product: ProductKey, units: number): ProductAmount =>
  amountFromUnits(product, units)

export type SalesProductSummary = {
  regular: ProductAmount
  free: ProductAmount
  total: ProductAmount
}

export const isCompletedSaleOrder = (order: Order): boolean => order.status === 'Доставена'

export const completedSaleDate = (order: Order): string => order.deliveredAt || order.date

export const orderProductBreakdown = (order: Order, product: ProductKey): SalesProductSummary => {
  const regularUnits = product === 'p025'
    ? order.qty025 * getProductPackageSize('p025') + (order.qty025Pieces || 0)
    : product === 'p15'
      ? order.qty15 * getProductPackageSize('p15') + (order.qty15Pieces || 0)
      : order.flyers
  const freeUnits = product === 'p025'
    ? order.free025 * getProductPackageSize('p025') + (order.free025Pieces || 0)
    : product === 'p15'
      ? (order.free15 || 0) * getProductPackageSize('p15') + (order.free15Pieces || 0)
      : 0

  return {
    regular: amountFromUnits(product, regularUnits),
    free: amountFromUnits(product, freeUnits),
    total: amountFromUnits(product, regularUnits + freeUnits),
  }
}

export const salesProductSummary = (orders: Order[], product: ProductKey): SalesProductSummary => {
  const units = orders.filter(isCompletedSaleOrder).reduce((sum, order) => {
    const breakdown = orderProductBreakdown(order, product)
    sum.regular += breakdown.regular.units
    sum.free += breakdown.free.units
    return sum
  }, { regular: 0, free: 0 })

  return {
    regular: amountFromUnits(product, units.regular),
    free: amountFromUnits(product, units.free),
    total: amountFromUnits(product, units.regular + units.free),
  }
}

export const orderProductAmount = (order: Order, product: ProductKey): ProductAmount =>
  amountFromUnits(product, orderPieces(order)[product])

export const receiptProductAmount = (receipt: ReceiptGroup, product: ProductKey): ProductAmount => {
  const packageSize = getProductPackageSize(product)
  const units = receipt.lines
    .filter(line => line.product === product)
    .reduce((sum, line) => sum + (product === 'flyers' ? line.pieces : line.packages * packageSize + line.pieces), 0)
  return amountFromUnits(product, units)
}

export const orderHasProduct = (order: Order, product: ReportProduct): boolean =>
  product === 'all' || orderProductAmount(order, product).units > 0

export const receiptHasProduct = (receipt: ReceiptGroup, product: ReportProduct): boolean =>
  product === 'all' || receiptProductAmount(receipt, product).units > 0

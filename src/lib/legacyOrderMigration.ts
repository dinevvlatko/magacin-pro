import type { Order } from '../types'

export type LegacyProductCode = 'p025' | 'p15' | 'flyers'

export interface LegacyOrderItemRow {
  productCode: LegacyProductCode
  packages: number
  pieces: number
  freePackages: number
  freePieces: number
}

export type LegacyOrderShape = Pick<Order,
  'qty025' |
  'qty025Pieces' |
  'free025' |
  'free025Pieces' |
  'qty15' |
  'qty15Pieces' |
  'free15' |
  'free15Pieces' |
  'flyers'>

const productPackageSize: Record<LegacyProductCode, number> = {
  p025: 15,
  p15: 6,
  flyers: 1,
}

const mapLegacyRow = (
  productCode: LegacyProductCode,
  packages: number,
  pieces: number,
  freePackages = 0,
  freePieces = 0,
): LegacyOrderItemRow => ({
  productCode,
  packages,
  pieces,
  freePackages,
  freePieces,
})

const hasQuantity = (value: number | undefined) => Number.isFinite(value) && (value ?? 0) > 0

const pushLegacyRow = (
  rows: LegacyOrderItemRow[],
  productCode: LegacyProductCode,
  packages: number,
  pieces: number,
  freePackages = 0,
  freePieces = 0,
) => {
  if (hasQuantity(packages) || hasQuantity(pieces) || hasQuantity(freePackages) || hasQuantity(freePieces)) {
    rows.push(mapLegacyRow(productCode, packages, pieces, freePackages, freePieces))
  }
}

export const buildLegacyOrderItems = (order: LegacyOrderShape): LegacyOrderItemRow[] => {
  const rows: LegacyOrderItemRow[] = []

  pushLegacyRow(rows, 'p025', order.qty025 ?? 0, order.qty025Pieces ?? 0, order.free025 ?? 0, order.free025Pieces ?? 0)
  pushLegacyRow(rows, 'p15', order.qty15 ?? 0, order.qty15Pieces ?? 0, order.free15 ?? 0, order.free15Pieces ?? 0)
  pushLegacyRow(rows, 'flyers', 0, order.flyers ?? 0, 0, 0)

  return rows
}

export const itemPieceCount = (row: LegacyOrderItemRow) => {
  const packageSize = productPackageSize[row.productCode]
  return (row.packages + row.freePackages) * packageSize + row.pieces + row.freePieces
}

export const legacyOrderTotals = (order: LegacyOrderShape) => {
  const rows = buildLegacyOrderItems(order)
  return {
    p025: rows.find(row => row.productCode === 'p025') ? itemPieceCount(rows.find(row => row.productCode === 'p025')!) : 0,
    p15: rows.find(row => row.productCode === 'p15') ? itemPieceCount(rows.find(row => row.productCode === 'p15')!) : 0,
    flyers: rows.find(row => row.productCode === 'flyers') ? itemPieceCount(rows.find(row => row.productCode === 'flyers')!) : 0,
  }
}

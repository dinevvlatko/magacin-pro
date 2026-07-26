import type { Order } from '../types'

export interface OrderReportTotals {
  p025Packages: number
  p025Pieces: number
  p15Packages: number
  p15Pieces: number
  flyers: number
}

export const orderReportTotals = (orders: Order[]): OrderReportTotals =>
  orders.reduce<OrderReportTotals>(
    (total, order) => ({
      p025Packages: total.p025Packages + order.qty025 + order.free025,
      p025Pieces: total.p025Pieces + (order.qty025Pieces || 0) + (order.free025Pieces || 0),
      p15Packages: total.p15Packages + order.qty15 + (order.free15 || 0),
      p15Pieces: total.p15Pieces + (order.qty15Pieces || 0) + (order.free15Pieces || 0),
      flyers: total.flyers + order.flyers,
    }),
    { p025Packages: 0, p025Pieces: 0, p15Packages: 0, p15Pieces: 0, flyers: 0 },
  )


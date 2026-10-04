import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Order } from '../types'
import type { ReportPrintDocument } from '../lib/reportDocuments'
import { ReportPrint } from './ReportsPage'

const deliveredOrder: Order = {
  id: 'delivered-order',
  number: 'PG-2026-0099',
  client: 'Тест клиент кој не смее да се печати',
  city: 'Скопје',
  date: '2026-10-01',
  deliveredAt: '2026-10-04',
  qty025: 2,
  qty025Pieces: 0,
  qty15: 1,
  qty15Pieces: 0,
  free025: 1,
  free025Pieces: 0,
  free15: 0,
  free15Pieces: 0,
  flyers: 100,
  note: '',
  status: 'Доставена',
  packed: { regular025: true, bib15: true, free025: true, free15: true, flyers: true },
  stockDeducted: true,
}

describe('sales report print', () => {
  it('prints only aggregate product totals without clients or order details', () => {
    const report: ReportPrintDocument = {
      kind: 'sales',
      product: 'all',
      periodLabel: '01/10/2026 – 04/10/2026',
      generatedAt: '2026-10-04T12:00:00.000Z',
      orders: [deliveredOrder],
      receipts: [],
    }

    const html = renderToStaticMarkup(<ReportPrint report={report} />)

    expect(html).toContain('ИЗВЕШТАЈ ЗА ПРОДАЖБА')
    expect(html).toContain('30 шишиња продадено')
    expect(html).toContain('6 БиБ продадено')
    expect(html).toContain('100 парчиња продадено')
    expect(html).not.toContain(deliveredOrder.client)
    expect(html).not.toContain(deliveredOrder.number)
    expect(html).not.toContain('<table')
  })
})

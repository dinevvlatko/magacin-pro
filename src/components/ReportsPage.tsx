import { useMemo, useState } from 'react'
import { Printer } from 'lucide-react'
import type { AppState, Order, OrderStatus, ProductKey } from '../types'
import { orderPieces, productName } from '../lib/logic'
import { formatDocumentDate } from '../lib/date'
import {
  completedSaleDate,
  isCompletedSaleOrder,
  orderHasProduct,
  orderProductAmount,
  receiptGroups,
  receiptHasProduct,
  receiptProductAmount,
  reportDateMatches,
  reportProductKeys,
  salesProductSummary,
  selectedReportProducts,
  type ReportPrintDocument,
  type ReportPeriod,
  type ReportProduct,
} from '../lib/reportDocuments'
import { Card, Empty, PageHeader } from './UI'
import './ReportsPage.css'

type ReportStatus = 'active' | 'all' | OrderStatus
type ReportDocumentKind = 'orders' | 'receipts' | 'sales'

type OrderReportRow = {
  order: Order
  regular025: number
  gratis025: number
  ordered025: number
  regular15: number
  gratis15: number
  ordered15: number
  orderedFlyers: number
  issued025: number
  issued15: number
  issuedFlyers: number
  missing025: boolean
}

const statusClass = (status: OrderStatus) => `status ${status.replaceAll(' ', '-').toLowerCase()}`

const periodLabel = (period: ReportPeriod, fromDate: string, toDate: string) => {
  if (period === 'month') return 'Овој месец'
  if (period === 'year') return 'Оваа година'
  if (period === 'custom') return `${fromDate ? formatDocumentDate(fromDate) : 'почеток'} – ${toDate ? formatDocumentDate(toDate) : 'денес'}`
  return 'Сите датуми'
}

const productUnit = (product: ProductKey) => product === 'p025' ? 'шишиња' : product === 'p15' ? 'БиБ' : 'парчиња'

const amountLabel = (packages: number, pieces: number, product: ProductKey) =>
  product === 'flyers' ? `${pieces} парчиња` : `${packages} пак. + ${pieces} пар.`

const toggleId = (current: Set<string>, id: string) => {
  const next = new Set(current)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

const localDateValue = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

const currentMonthRange = () => {
  const now = new Date()
  return {
    from: localDateValue(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: localDateValue(now),
  }
}

export function ReportsPage({ state, onPrint }: { state: AppState; onPrint: (report: ReportPrintDocument) => void }) {
  const [documentKind, setDocumentKind] = useState<ReportDocumentKind>('orders')
  const [period, setPeriod] = useState<ReportPeriod>('all')
  const [status, setStatus] = useState<ReportStatus>('active')
  const [product, setProduct] = useState<ReportProduct>('all')
  const [client, setClient] = useState('all')
  const [city, setCity] = useState('all')
  const [query, setQuery] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(() => new Set())
  const [selectedReceiptNumbers, setSelectedReceiptNumbers] = useState<Set<string>>(() => new Set())

  const clients = useMemo(() => [...new Set(state.orders.map(order => order.client.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'mk')), [state.orders])
  const cities = useMemo(() => [...new Set(state.orders.map(order => order.city.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'mk')), [state.orders])
  const visibleProducts = selectedReportProducts(product)

  const orders = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return state.orders
      .filter(order => reportDateMatches(documentKind === 'sales' ? completedSaleDate(order) : order.date, period, fromDate, toDate))
      .filter(order => documentKind === 'sales'
        ? isCompletedSaleOrder(order)
        : status === 'all' || (status === 'active' ? order.status !== 'Откажана' : order.status === status))
      .filter(order => client === 'all' || order.client === client)
      .filter(order => city === 'all' || order.city === city)
      .filter(order => orderHasProduct(order, product))
      .filter(order => `${order.number} ${order.client} ${order.city} ${order.note}`.toLowerCase().includes(normalizedQuery))
      .toSorted((a, b) => (documentKind === 'sales' ? completedSaleDate(b).localeCompare(completedSaleDate(a)) : b.date.localeCompare(a.date)) || b.number.localeCompare(a.number))
  }, [city, client, documentKind, fromDate, period, product, query, state.orders, status, toDate])

  const receipts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return receiptGroups(state.movements)
      .filter(receipt => reportDateMatches(receipt.date, period, fromDate, toDate))
      .filter(receipt => receiptHasProduct(receipt, product))
      .filter(receipt => `${receipt.number} ${receipt.party} ${receipt.note}`.toLowerCase().includes(normalizedQuery))
  }, [fromDate, period, product, query, state.movements, toDate])

  const reportRows = useMemo<OrderReportRow[]>(() => orders.map(order => {
    const quantities = orderPieces(order)
    const regular025 = quantities.p025 - (order.free025 * 15 + (order.free025Pieces || 0))
    const gratis025 = order.free025 * 15 + (order.free025Pieces || 0)
    const regular15 = quantities.p15 - ((order.free15 || 0) * 6 + (order.free15Pieces || 0))
    const gratis15 = (order.free15 || 0) * 6 + (order.free15Pieces || 0)
    return {
      order,
      regular025,
      gratis025,
      ordered025: quantities.p025,
      regular15,
      gratis15,
      ordered15: quantities.p15,
      orderedFlyers: order.flyers,
      issued025: order.stockDeducted ? quantities.p025 : 0,
      issued15: order.stockDeducted ? quantities.p15 : 0,
      issuedFlyers: order.stockDeducted ? order.flyers : 0,
      missing025: quantities.p025 <= 0,
    }
  }), [orders])

  const totals = useMemo(() => reportRows.reduce((sum, row) => ({
    regular025: sum.regular025 + row.regular025,
    gratis025: sum.gratis025 + row.gratis025,
    ordered025: sum.ordered025 + row.ordered025,
    regular15: sum.regular15 + row.regular15,
    gratis15: sum.gratis15 + row.gratis15,
    ordered15: sum.ordered15 + row.ordered15,
    orderedFlyers: sum.orderedFlyers + row.orderedFlyers,
    issued025: sum.issued025 + row.issued025,
    issued15: sum.issued15 + row.issued15,
    issuedFlyers: sum.issuedFlyers + row.issuedFlyers,
  }), { regular025: 0, gratis025: 0, ordered025: 0, regular15: 0, gratis15: 0, ordered15: 0, orderedFlyers: 0, issued025: 0, issued15: 0, issuedFlyers: 0 }), [reportRows])

  const receiptTotals = useMemo(() => Object.fromEntries(reportProductKeys.map(key => {
    const units = receipts.reduce((sum, receipt) => sum + receiptProductAmount(receipt, key).units, 0)
    if (key === 'flyers') return [key, { packages: 0, pieces: units, units }]
    const packageSize = key === 'p025' ? 15 : 6
    return [key, { packages: Math.floor(units / packageSize), pieces: units % packageSize, units }]
  })) as Record<ProductKey, { packages: number; pieces: number; units: number }>, [receipts])

  const salesTotals = useMemo(() => Object.fromEntries(reportProductKeys.map(key => [key, salesProductSummary(orders, key)])) as Record<ProductKey, ReturnType<typeof salesProductSummary>>, [orders])

  const clientRows = useMemo(() => [...reportRows.reduce((map, row) => {
    const key = row.order.client.trim() || 'Без клиент'
    const current = map.get(key) || { client: key, orders: 0, ordered025: 0, gratis025: 0, issued025: 0, ordered15: 0, gratis15: 0, issued15: 0, orderedFlyers: 0, issuedFlyers: 0 }
    current.orders += 1
    current.ordered025 += row.ordered025
    current.gratis025 += row.gratis025
    current.issued025 += row.issued025
    current.ordered15 += row.ordered15
    current.gratis15 += row.gratis15
    current.issued15 += row.issued15
    current.orderedFlyers += row.orderedFlyers
    current.issuedFlyers += row.issuedFlyers
    map.set(key, current)
    return map
  }, new Map<string, { client: string; orders: number; ordered025: number; gratis025: number; issued025: number; ordered15: number; gratis15: number; issued15: number; orderedFlyers: number; issuedFlyers: number }>()).values()]
    .sort((a, b) => (b.issued025 + b.issued15 + b.issuedFlyers) - (a.issued025 + a.issued15 + a.issuedFlyers)), [reportRows])

  const selectedOrders = orders.filter(order => selectedOrderIds.has(order.id))
  const selectedReceipts = receipts.filter(receipt => selectedReceiptNumbers.has(receipt.number))
  const allOrdersSelected = orders.length > 0 && orders.every(order => selectedOrderIds.has(order.id))
  const allReceiptsSelected = receipts.length > 0 && receipts.every(receipt => selectedReceiptNumbers.has(receipt.number))
  const missing025Orders = reportRows.filter(row => row.missing025)
  const invalidSalesDateRange = period === 'custom' && (!fromDate || !toDate || fromDate > toDate)

  const selectAllOrders = () => setSelectedOrderIds(current => {
    const next = new Set(current)
    if (allOrdersSelected) orders.forEach(order => next.delete(order.id))
    else orders.forEach(order => next.add(order.id))
    return next
  })

  const selectAllReceipts = () => setSelectedReceiptNumbers(current => {
    const next = new Set(current)
    if (allReceiptsSelected) receipts.forEach(receipt => next.delete(receipt.number))
    else receipts.forEach(receipt => next.add(receipt.number))
    return next
  })

  const printSelection = () => onPrint({
    kind: documentKind === 'orders' ? 'dispatch' : 'receipts',
    product,
    periodLabel: periodLabel(period, fromDate, toDate),
    generatedAt: new Date().toISOString(),
    orders: documentKind === 'orders' ? selectedOrders : [],
    receipts: documentKind === 'receipts' ? selectedReceipts : [],
  })

  const printSalesReport = () => onPrint({
    kind: 'sales',
    product,
    periodLabel: periodLabel(period, fromDate, toDate),
    generatedAt: new Date().toISOString(),
    orders,
    receipts: [],
  })

  const openSalesReport = () => {
    setDocumentKind('sales')
    setProduct('all')
    setClient('all')
    setCity('all')
    setQuery('')
    if (period !== 'custom') {
      const range = currentMonthRange()
      setPeriod('custom')
      setFromDate(range.from)
      setToDate(range.to)
    }
  }

  const resetFilters = () => {
    if (documentKind === 'sales') {
      const range = currentMonthRange()
      setPeriod('custom')
      setFromDate(range.from)
      setToDate(range.to)
    } else {
      setPeriod('all')
      setFromDate('')
      setToDate('')
    }
    setStatus('active')
    setProduct('all')
    setClient('all')
    setCity('all')
    setQuery('')
    setSelectedOrderIds(new Set())
    setSelectedReceiptNumbers(new Set())
  }

  return <>
    <PageHeader title="Извештаи" />
    <div className="report-kind-tabs" role="tablist" aria-label="Тип на извештај">
      <button className={documentKind === 'orders' ? 'active' : ''} onClick={() => setDocumentKind('orders')}>Испратници / нарачки</button>
      <button className={documentKind === 'sales' ? 'active' : ''} onClick={openSalesReport}>Целокупна продажба</button>
      <button className={documentKind === 'receipts' ? 'active' : ''} onClick={() => setDocumentKind('receipts')}>Приемници</button>
    </div>
    <Card className={`report-filters${documentKind === 'sales' ? ' sales-only-filters' : ''}`}>
      <div className="report-toolbar">
        {documentKind === 'sales' ? <><label>Од датум<input type="date" value={fromDate} onChange={event => setFromDate(event.target.value)} /></label><label>До датум<input type="date" value={toDate} onChange={event => setToDate(event.target.value)} /></label></> : <>
          <label>Период<select value={period} onChange={event => setPeriod(event.target.value as ReportPeriod)}><option value="all">Сите датуми</option><option value="month">Овој месец</option><option value="year">Оваа година</option><option value="custom">Избран период</option></select></label>
          {period === 'custom' && <><label>Од<input type="date" value={fromDate} onChange={event => setFromDate(event.target.value)} /></label><label>До<input type="date" value={toDate} onChange={event => setToDate(event.target.value)} /></label></>}
          <label>Производ<select aria-label="Производ за извештај" value={product} onChange={event => setProduct(event.target.value as ReportProduct)}><option value="all">Сите производи</option><option value="p025">{productName('p025')}</option><option value="p15">{productName('p15')}</option><option value="flyers">{productName('flyers')}</option></select></label>
          {documentKind === 'orders' && <><label>Статус<select value={status} onChange={event => setStatus(event.target.value as ReportStatus)}><option value="active">Сите освен откажани</option><option value="all">Сите статуси</option><option value="Нова">Нова</option><option value="Во подготовка">Во подготовка</option><option value="Спакувана">Спакувана</option><option value="Излезена">Излезена</option><option value="Испратена">Испратена</option><option value="Доставена">Доставена</option><option value="Откажана">Откажана</option><option value="Чека залиха">Чека залиха</option></select></label><label>Клиент<select value={client} onChange={event => setClient(event.target.value)}><option value="all">Сите клиенти</option>{clients.map(item => <option key={item}>{item}</option>)}</select></label><label>Град<select value={city} onChange={event => setCity(event.target.value)}><option value="all">Сите градови</option>{cities.map(item => <option key={item}>{item}</option>)}</select></label></>}
          <label className="report-search">Пребарај<input placeholder={documentKind === 'receipts' ? 'Број, тим или забелешка' : 'Број, клиент или град'} value={query} onChange={event => setQuery(event.target.value)} /></label>
        </>}
        <button className="ghost report-reset" onClick={resetFilters}>Исчисти филтри</button>
      </div>
    </Card>

    {documentKind !== 'receipts' ? <>
      {documentKind === 'sales' && <Card className="sales-report-notice"><div><strong>Целокупен извештај за продажба</strong><span>Избери период и добиј ги само вкупните бројки за сите производи. Се пресметуваат доставените нарачки, а гратис количината е прикажана одделно.</span></div><button className="primary" disabled={orders.length === 0 || invalidSalesDateRange} onClick={printSalesReport}><Printer size={17} /> Печати целокупен извештај</button></Card>}
      {documentKind === 'orders' && (product === 'all' || product === 'p025') && missing025Orders.length > 0 && <Card><div className="stock-validation warning"><span><b>Контрола на податоци:</b> {missing025Orders.length} нарачки немаат внесено {productName('p025')}: {missing025Orders.map(row => row.order.number).join(', ')}.</span></div></Card>}
      <div className="report-grid">
        {documentKind === 'sales' ? visibleProducts.map(key => <Card className="report-total sales-total" key={key}><span>Продадено {productName(key)}</span><strong>{salesTotals[key].regular.units} {productUnit(key)}</strong><small>{amountLabel(salesTotals[key].regular.packages, salesTotals[key].regular.pieces, key)}</small><div><span>Гратис <b>{salesTotals[key].free.units}</b></span><span>Вкупно испорачано <b>{salesTotals[key].total.units}</b></span></div></Card>) : <>
          {(product === 'all' || product === 'p025') && <><Card className="report-total"><span>Нарачано {productName('p025')}</span><strong>{totals.ordered025} шишиња</strong><small>Редовно {totals.regular025} • гратис {totals.gratis025}</small></Card><Card className="report-total"><span>Реално издадено {productName('p025')}</span><strong>{totals.issued025} шишиња</strong><small>{Math.floor(totals.issued025 / 15)} пак. + {totals.issued025 % 15} пар.</small></Card></>}
          {(product === 'all' || product === 'p15') && <><Card className="report-total"><span>Нарачано {productName('p15')}</span><strong>{totals.ordered15} БиБ</strong><small>Редовно {totals.regular15} • гратис {totals.gratis15}</small></Card><Card className="report-total"><span>Реално издадено {productName('p15')}</span><strong>{totals.issued15} БиБ</strong><small>{Math.floor(totals.issued15 / 6)} пак. + {totals.issued15 % 6} пар.</small></Card></>}
          {(product === 'all' || product === 'flyers') && <><Card className="report-total"><span>Нарачани флаери</span><strong>{totals.orderedFlyers}</strong><small>Според нарачките</small></Card><Card className="report-total"><span>Реално издадени флаери</span><strong>{totals.issuedFlyers}</strong><small>Според магацинските излези</small></Card></>}
        </>}
        {documentKind === 'orders' && <Card className="report-total"><span>Нарачки во извештај</span><strong>{orders.length}</strong><small>Според избраните филтри</small></Card>}
      </div>
      {documentKind === 'orders' && <Card className="report-selection-bar"><div><strong>{selectedOrders.length} избрани нарачки</strong><span>од {orders.length} филтрирани</span></div><div><button className="ghost" disabled={orders.length === 0} onClick={selectAllOrders}>{allOrdersSelected ? 'Отселектирај ги' : 'Селектирај ги филтрираните'}</button><button className="primary" disabled={selectedOrders.length === 0} onClick={printSelection}><Printer size={17} /> Печати испратница ({selectedOrders.length})</button></div></Card>}
      {documentKind === 'orders' && <><Card className="report-detail-card"><div className="section-title"><div><h3>Детален извештај по нарачка</h3><p>Избери ги редовите што треба да влезат во испратницата.</p></div></div>{reportRows.length === 0 ? <Empty text="Нема нарачки за избраните филтри." /> : <div className="table-wrap"><table className="report-detail-table"><thead><tr><th>Избор</th><th>Датум</th><th>Нарачка</th><th>Клиент / град</th><th>Статус</th>{visibleProducts.includes('p025') && <><th>0,250 нарачано</th><th>0,250 издадено</th></>}{visibleProducts.includes('p15') && <><th>БиБ нарачано</th><th>БиБ издадено</th></>}{visibleProducts.includes('flyers') && <><th>Флаери нарачано</th><th>Флаери издадено</th></>}</tr></thead><tbody>{reportRows.map(row => <tr className={selectedOrderIds.has(row.order.id) ? 'selected-report-row' : ''} key={row.order.id}><td><input aria-label={`Избери ${row.order.number}`} type="checkbox" checked={selectedOrderIds.has(row.order.id)} onChange={() => setSelectedOrderIds(current => toggleId(current, row.order.id))} /></td><td>{formatDocumentDate(row.order.date)}</td><td><b>{row.order.number}</b></td><td><b>{row.order.client}</b><small>{row.order.city}</small></td><td><span className={statusClass(row.order.status)}>{row.order.status}</span></td>{visibleProducts.includes('p025') && <><td><b>{row.ordered025}</b><small>ред. {row.regular025} • гратис {row.gratis025}</small></td><td>{row.issued025}</td></>}{visibleProducts.includes('p15') && <><td><b>{row.ordered15}</b><small>ред. {row.regular15} • гратис {row.gratis15}</small></td><td>{row.issued15}</td></>}{visibleProducts.includes('flyers') && <><td>{row.orderedFlyers}</td><td>{row.issuedFlyers}</td></>}</tr>)}</tbody></table></div>}</Card>
      <Card><div className="section-title"><div><h3>Збирно по клиент</h3><p>Нарачано, гратис и реално издадено по клиент.</p></div></div>{clientRows.length === 0 ? <Empty text="Нема податоци." /> : <div className="table-wrap"><table><thead><tr><th>Клиент</th><th>Нарачки</th>{visibleProducts.includes('p025') && <><th>0,250 нарачано</th><th>0,250 гратис</th><th>0,250 издадено</th></>}{visibleProducts.includes('p15') && <><th>БиБ нарачано</th><th>БиБ гратис</th><th>БиБ издадено</th></>}{visibleProducts.includes('flyers') && <><th>Флаери нарачано</th><th>Флаери издадено</th></>}</tr></thead><tbody>{clientRows.map(row => <tr key={row.client}><td><b>{row.client}</b></td><td>{row.orders}</td>{visibleProducts.includes('p025') && <><td>{row.ordered025}</td><td>{row.gratis025}</td><td>{row.issued025}</td></>}{visibleProducts.includes('p15') && <><td>{row.ordered15}</td><td>{row.gratis15}</td><td>{row.issued15}</td></>}{visibleProducts.includes('flyers') && <><td>{row.orderedFlyers}</td><td>{row.issuedFlyers}</td></>}</tr>)}</tbody></table></div>}</Card></>}
    </> : <>
      <div className="report-grid">
        {visibleProducts.map(key => <Card className="report-total" key={key}><span>Примено {productName(key)}</span><strong>{receiptTotals[key].units} {productUnit(key)}</strong><small>{amountLabel(receiptTotals[key].packages, receiptTotals[key].pieces, key)}</small></Card>)}
        <Card className="report-total"><span>Приемници во извештај</span><strong>{receipts.length}</strong><small>Според избраните филтри</small></Card>
      </div>
      <Card className="report-selection-bar"><div><strong>{selectedReceipts.length} избрани приемници</strong><span>од {receipts.length} филтрирани</span></div><div><button className="ghost" disabled={receipts.length === 0} onClick={selectAllReceipts}>{allReceiptsSelected ? 'Отселектирај ги' : 'Селектирај ги филтрираните'}</button><button className="primary" disabled={selectedReceipts.length === 0} onClick={printSelection}><Printer size={17} /> Печати приемен извештај ({selectedReceipts.length})</button></div></Card>
      <Card className="report-detail-card"><div className="section-title"><div><h3>Преглед на приемници</h3><p>Избери ги приемниците што треба да влезат во печатениот извештај.</p></div></div>{receipts.length === 0 ? <Empty text="Нема приемници за избраните филтри." /> : <div className="table-wrap"><table className="report-detail-table"><thead><tr><th>Избор</th><th>Датум</th><th>Приемница</th><th>Работници / тим</th>{visibleProducts.map(key => <th key={key}>{productName(key)}</th>)}<th>Забелешка</th></tr></thead><tbody>{receipts.map(receipt => <tr className={selectedReceiptNumbers.has(receipt.number) ? 'selected-report-row' : ''} key={receipt.number}><td><input aria-label={`Избери ${receipt.number}`} type="checkbox" checked={selectedReceiptNumbers.has(receipt.number)} onChange={() => setSelectedReceiptNumbers(current => toggleId(current, receipt.number))} /></td><td>{formatDocumentDate(receipt.date)}</td><td><b>{receipt.number}</b></td><td>{receipt.party || '—'}</td>{visibleProducts.map(key => { const amount = receiptProductAmount(receipt, key); return <td key={key}>{amount.units > 0 ? <><b>{amount.units}</b><small>{amountLabel(amount.packages, amount.pieces, key)}</small></> : '—'}</td> })}<td>{receipt.note || '—'}</td></tr>)}</tbody></table></div>}</Card>
    </>}
  </>
}

export function ReportPrint({ report }: { report: ReportPrintDocument }) {
  const products = selectedReportProducts(report.product)
  const isDispatch = report.kind === 'dispatch'
  const isSales = report.kind === 'sales'
  const isOrderReport = isDispatch || isSales
  const documents = isOrderReport ? report.orders : report.receipts
  const totals = Object.fromEntries(reportProductKeys.map(product => {
    const units = isOrderReport
      ? report.orders.reduce((sum, order) => sum + orderProductAmount(order, product).units, 0)
      : report.receipts.reduce((sum, receipt) => sum + receiptProductAmount(receipt, product).units, 0)
    const packageSize = product === 'p025' ? 15 : product === 'p15' ? 6 : 1
    return [product, { packages: product === 'flyers' ? 0 : Math.floor(units / packageSize), pieces: product === 'flyers' ? units : units % packageSize, units }]
  })) as Record<ProductKey, { packages: number; pieces: number; units: number }>
  const salesTotals = Object.fromEntries(reportProductKeys.map(product => [product, salesProductSummary(report.orders, product)])) as Record<ProductKey, ReturnType<typeof salesProductSummary>>
  const dispatchRows = report.orders.flatMap(order => products
    .map(product => ({ order, product, amount: orderProductAmount(order, product) }))
    .filter(row => row.amount.units > 0))
  const receiptRows = report.receipts.flatMap(receipt => products
    .map(product => ({ receipt, product, amount: receiptProductAmount(receipt, product) }))
    .filter(row => row.amount.units > 0))

  return <div className="print-sheet report-print-sheet">
    <header className="packing-print-head"><h1>{isSales ? 'ИЗВЕШТАЈ ЗА ПРОДАЖБА' : isDispatch ? (documents.length === 1 ? 'ИСПРАТНИЦА' : 'ЗБИРНА ИСПРАТНИЦА') : 'ПРЕГЛЕД НА ПРИЕМНИЦИ'}</h1></header>
    <section className="packing-print-meta report-print-meta">{isSales ? <><div><span>Период</span><strong>{report.periodLabel}</strong></div><div><span>Доставени нарачки</span><b>{documents.length}</b></div><div><span>Датум на печатење</span><b>{formatDocumentDate(report.generatedAt.slice(0, 10))}</b></div></> : <><div><span>Период</span><strong>{report.periodLabel}</strong></div><div><span>Производ</span><strong>{report.product === 'all' ? 'Сите производи' : productName(report.product)}</strong></div><div><span>Број на документи</span><b>{documents.length}</b></div><div><span>Датум на печатење</span><b>{formatDocumentDate(report.generatedAt.slice(0, 10))}</b></div></>}</section>
    {!isSales && <table className="packing-print-table report-print-table"><thead><tr><th>Датум</th><th>Документ</th><th>{isDispatch ? 'Клиент / град' : 'Работници / тим'}</th><th>Производ</th><th>Пакети</th><th>Парчиња</th><th>Вкупно</th>{isDispatch && <th>Статус</th>}</tr></thead><tbody>
      {isDispatch ? dispatchRows.map(({ order, product, amount }) => <tr key={`${order.id}-${product}`}><td>{formatDocumentDate(order.date)}</td><td><strong>{order.number}</strong></td><td><strong>{order.client}</strong><small>{order.city}</small></td><td>{productName(product)}</td><td>{product === 'flyers' ? '—' : amount.packages}</td><td>{amount.pieces}</td><td><strong>{amount.units} {productUnit(product)}</strong></td><td>{order.status}</td></tr>) : receiptRows.map(({ receipt, product, amount }) => <tr key={`${receipt.number}-${product}`}><td>{formatDocumentDate(receipt.date)}</td><td><strong>{receipt.number}</strong></td><td>{receipt.party || '—'}</td><td>{productName(product)}</td><td>{product === 'flyers' ? '—' : amount.packages}</td><td>{amount.pieces}</td><td><strong>{amount.units} {productUnit(product)}</strong></td></tr>)}
    </tbody></table>}
    <section className="report-print-totals"><h2>Вкупно по производ</h2>{products.map(product => isSales ? <div key={product}><span>{productName(product)}</span><strong>{salesTotals[product].regular.units} {productUnit(product)} продадено</strong><small>Гратис {salesTotals[product].free.units} • вкупно испорачано {salesTotals[product].total.units}</small></div> : <div key={product}><span>{productName(product)}</span><strong>{totals[product].units} {productUnit(product)}</strong><small>{amountLabel(totals[product].packages, totals[product].pieces, product)}</small></div>)}</section>
    <div className="report-print-signatures"><div className="packing-sign"><span>{isDispatch ? 'Предал' : 'Подготвил'}</span><i /></div><div className="packing-sign"><span>{isDispatch ? 'Примил' : 'Проверил'}</span><i /></div></div>
  </div>
}

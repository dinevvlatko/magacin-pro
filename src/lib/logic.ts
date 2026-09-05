import type { AppState, Movement, Order, OrderStatus, PackedChecks, ProductKey, StockUnit } from '../types'

export type WarehouseStockByProduct = Record<ProductKey, number>
export type WarehouseSnapshot = {
  physical_stock: WarehouseStockByProduct
  reserved_stock: WarehouseStockByProduct
  available_stock: WarehouseStockByProduct
  deducted_stock: WarehouseStockByProduct
  received_stock: WarehouseStockByProduct
  damaged_stock: WarehouseStockByProduct
  corrected_stock: WarehouseStockByProduct
}

export interface ItemQuantityRow {
  packages: number
  pieces: number
  freePackages: number
  freePieces: number
}

export const normalize=(total:number,perPackage:number):StockUnit=>({packages:Math.floor(total/perPackage),pieces:total%perPackage,total,perPackage})
export const breakdown=(packages:number,pieces=0)=>`${packages} пак. + ${pieces} пар.`

export const getProductPackageSize=(product:ProductKey):number=>({
  p025: 15,
  p15: 6,
  flyers: 1,
}[product])

export const getItemQuantity=(product:ProductKey,row:ItemQuantityRow):number=>{
  const packageSize=getProductPackageSize(product)
  const regularTotal=row.packages*packageSize+row.pieces
  const freeTotal=row.freePackages*packageSize+row.freePieces
  return regularTotal+freeTotal
}

export const orderPieces=(o:Order)=>({
  p025: getItemQuantity('p025', { packages: o.qty025, pieces: o.qty025Pieces ?? 0, freePackages: o.free025, freePieces: o.free025Pieces ?? 0 }),
  p15: getItemQuantity('p15', { packages: o.qty15, pieces: o.qty15Pieces ?? 0, freePackages: o.free15 ?? 0, freePieces: o.free15Pieces ?? 0 }),
  flyers: getItemQuantity('flyers', { packages: 0, pieces: o.flyers, freePackages: 0, freePieces: 0 }),
})

const rowPacked=(packages:number,pieces:number,checked:boolean|undefined)=>packages+pieces===0||Boolean(checked)
export const allPacked=(o:Order)=>rowPacked(o.qty025,o.qty025Pieces||0,o.packed.regular025)&&rowPacked(o.qty15,o.qty15Pieces||0,o.packed.bib15)&&rowPacked(o.free025,o.free025Pieces||0,o.packed.free025)&&rowPacked(o.free15||0,o.free15Pieces||0,o.packed.free15)&&rowPacked(0,o.flyers,o.packed.flyers)
export const deductStatuses=new Set(['Спакувана','Излезена','Испратена','Доставена'])
export const activeStatuses=new Set(['Чека залиха','Нова','Во подготовка'])
export const reservingStatuses=new Set(['Нова','Во подготовка'])
export const allowedTransitions:Record<OrderStatus,OrderStatus[]>={
 'Чека залиха':['Нова','Во подготовка','Откажана'],
 'Нова':['Во подготовка','Спакувана','Откажана'],
 'Во подготовка':['Нова','Спакувана','Откажана'],
 'Спакувана':['Нова','Во подготовка','Излезена','Испратена','Откажана'],
 'Излезена':['Нова','Во подготовка','Спакувана','Испратена','Откажана'],
 'Испратена':['Нова','Во подготовка','Спакувана','Излезена','Доставена','Откажана'],
 'Доставена':['Нова','Во подготовка','Спакувана','Излезена','Испратена','Откажана'],
 'Откажана':['Нова','Во подготовка'],
 'Вратена':['Нова','Во подготовка','Спакувана','Откажана'],
}

const zeroStock = (): WarehouseStockByProduct => ({ p025: 0, p15: 0, flyers: 0 })
const productKeys = ['p025', 'p15', 'flyers'] as const

export const calculateWarehouseSnapshot=(state:AppState):WarehouseSnapshot=>{
  const physical_stock = {
    p025: state.warehouse.p025.total,
    p15: state.warehouse.p15.total,
    flyers: state.warehouse.flyers,
  }

  const reserved_stock = zeroStock()
  const deducted_stock = zeroStock()
  const received_stock = zeroStock()
  const damaged_stock = zeroStock()
  const corrected_stock = zeroStock()

  state.orders.forEach(order => {
    const total=orderPieces(order)
    if (reservingStatuses.has(order.status) && !order.stockDeducted) {
      reserved_stock.p025 += total.p025
      reserved_stock.p15 += total.p15
      reserved_stock.flyers += total.flyers
    }
    if (deductStatuses.has(order.status) && order.stockDeducted) {
      deducted_stock.p025 += total.p025
      deducted_stock.p15 += total.p15
      deducted_stock.flyers += total.flyers
    }
  })

  // warehouse is the current balance and is updated together with every
  // movement. Movements are an audit trail, so replaying them here would
  // subtract or add the same quantity a second time.
  state.movements.forEach(movement => {
    const total = movement.product === 'p025' ? movement.packages * 15 + movement.pieces : movement.product === 'p15' ? movement.packages * 6 + movement.pieces : movement.pieces
    if (movement.type === 'Влез' || movement.type === 'Враќање') {
      received_stock[movement.product] += total
    }
    if (movement.type === 'Корекција') {
      corrected_stock[movement.product] += total
    }
    if (movement.type === 'Оштетување') {
      damaged_stock[movement.product] += total
    }
  })

  productKeys.forEach(product => {
    physical_stock[product] = Math.max(0, physical_stock[product])
    reserved_stock[product] = Math.max(0, reserved_stock[product])
    deducted_stock[product] = Math.max(0, deducted_stock[product])
    received_stock[product] = Math.max(0, received_stock[product])
    damaged_stock[product] = Math.max(0, damaged_stock[product])
    corrected_stock[product] = Math.max(0, corrected_stock[product])
  })

  const available_stock = {
    p025: Math.max(0, physical_stock.p025 - reserved_stock.p025),
    p15: Math.max(0, physical_stock.p15 - reserved_stock.p15),
    flyers: Math.max(0, physical_stock.flyers - reserved_stock.flyers),
  }

  return {
    physical_stock,
    reserved_stock,
    available_stock,
    deducted_stock,
    received_stock,
    damaged_stock,
    corrected_stock,
  }
}

export const normalizeWarehouseTotals=(state:AppState):AppState=>{
  const normalized = {
    ...state,
    orders: state.orders.map(order => {
      if (deductStatuses.has(order.status) && !order.stockDeducted) {
        return { ...order, stockDeducted: true }
      }
      return order
    }),
  }

  return normalized
}

const productStateCanSatisfy=(s:AppState,order:Order)=>{
  const snapshot=calculateWarehouseSnapshot(s)
  const needed=orderPieces(order)
  return needed.p025 <= snapshot.available_stock.p025 && needed.p15 <= snapshot.available_stock.p15 && needed.flyers <= snapshot.available_stock.flyers
}

export const deductOrderStock=(s:AppState,o:Order,status=o.status):AppState|null=>{
  if (o.stockDeducted) {
    return { ...s, orders: s.orders.map(x => x.id === o.id ? { ...x, status } : x) }
  }
  const need = orderPieces(o)
  const snapshot = calculateWarehouseSnapshot(s)
  if (snapshot.available_stock.p025 < need.p025 || snapshot.available_stock.p15 < need.p15 || snapshot.available_stock.flyers < need.flyers) {
    return null
  }
  const date = new Date().toISOString().slice(0, 10)
  const warehouse = {
    p025: normalize(Math.max(0, snapshot.physical_stock.p025 - need.p025), 15),
    p15: normalize(Math.max(0, snapshot.physical_stock.p15 - need.p15), 6),
    flyers: Math.max(0, snapshot.physical_stock.flyers - need.flyers),
  }
  return {
    ...s,
    warehouse,
    orders: s.orders.map(x => x.id === o.id ? { ...x, status, stockDeducted: true } : x),
    movements: [
      ...s.movements,
      { id: crypto.randomUUID(), date, product: 'p025', type: 'Излез', packages: o.qty025 + o.free025, pieces: (o.qty025Pieces ?? 0) + (o.free025Pieces ?? 0), party: o.client, orderNumber: o.number, note: 'Автоматско одземање при пакување' },
      { id: crypto.randomUUID(), date, product: 'p15', type: 'Излез', packages: o.qty15 + (o.free15 ?? 0), pieces: (o.qty15Pieces ?? 0) + (o.free15Pieces ?? 0), party: o.client, orderNumber: o.number, note: 'Автоматско одземање при пакување' },
      { id: crypto.randomUUID(), date, product: 'flyers', type: 'Излез', packages: 0, pieces: o.flyers, party: o.client, orderNumber: o.number, note: 'Автоматско одземање при пакување' },
    ],
  }
}

export const returnOrderStock=(s:AppState,o:Order):AppState=>{
  const current=s.orders.find(x=>x.id===o.id)
  if (!current) return s
  if (!current.stockDeducted) {
    return { ...s, orders: s.orders.map(x => x.id === o.id ? { ...x, status: 'Откажана' } : x) }
  }
  const need=orderPieces(current)
  const date=new Date().toISOString().slice(0, 10)
  const warehouse = {
    p025: normalize(Math.max(0, s.warehouse.p025.total + need.p025), 15),
    p15: normalize(Math.max(0, s.warehouse.p15.total + need.p15), 6),
    flyers: Math.max(0, s.warehouse.flyers + need.flyers),
  }
  return {
    ...s,
    warehouse,
    orders: s.orders.map(x => x.id === o.id ? { ...x, status: 'Откажана', stockDeducted: false } : x),
    movements: [
      ...s.movements,
      { id: crypto.randomUUID(), date, product: 'p025', type: 'Враќање', packages: current.qty025 + current.free025, pieces: (current.qty025Pieces ?? 0) + (current.free025Pieces ?? 0), party: current.client, orderNumber: current.number, note: 'Автоматско враќање при откажување' },
      { id: crypto.randomUUID(), date, product: 'p15', type: 'Враќање', packages: current.qty15 + (current.free15 ?? 0), pieces: (current.qty15Pieces ?? 0) + (current.free15Pieces ?? 0), party: current.client, orderNumber: current.number, note: 'Автоматско враќање при откажување' },
      { id: crypto.randomUUID(), date, product: 'flyers', type: 'Враќање', packages: 0, pieces: current.flyers, party: current.client, orderNumber: current.number, note: 'Автоматско враќање при откажување' },
    ],
  }
}

export const changeOrderStatus=(s:AppState,o:Order,next:OrderStatus):AppState|null=>{
  const current=s.orders.find(x => x.id === o.id)
  if (!current) return null
  if (next === current.status) return s
  if (next === 'Откажана') {
    if (current.stockDeducted) return returnOrderStock(s, current)
    return { ...s, orders: s.orders.map(x => x.id === o.id ? { ...x, status: 'Откажана' } : x) }
  }

  if (current.status === 'Испратена' && next === 'Доставена') {
    return { ...s, orders: s.orders.map(x => x.id === o.id ? { ...x, status: next, stockDeducted: current.stockDeducted } : x) }
  }

  if (next === 'Нова' || next === 'Во подготовка') {
    if (current.stockDeducted) {
      const restored=returnOrderStock(s,current)
      const withStatus={...restored,orders:restored.orders.map(x=>x.id===o.id?{...x,status:next,stockDeducted:false}:x)}
      return productStateCanSatisfy(withStatus,{...current,status:next,stockDeducted:false}) ? withStatus : { ...withStatus, orders: withStatus.orders.map(x => x.id === o.id ? { ...x, status: 'Чека залиха', stockDeducted: false } : x) }
    }
    if (productStateCanSatisfy(s,{...current,status:next})) return { ...s, orders: s.orders.map(x => x.id === o.id ? { ...x, status: next } : x) }
    return { ...s, orders: s.orders.map(x => x.id === o.id ? { ...x, status: 'Чека залиха' } : x) }
  }

  if (next === 'Спакувана') {
    if (current.stockDeducted || deductStatuses.has(current.status)) {
      return { ...s, orders: s.orders.map(x => x.id === o.id ? { ...x, status: next, stockDeducted: true } : x) }
    }
    return deductOrderStock(s,current,next)
  }

  if (deductStatuses.has(next) && !current.stockDeducted && !deductStatuses.has(current.status)) {
    return deductOrderStock(s,current,next)
  }

  if (current.stockDeducted) {
    const restored=returnOrderStock(s,current)
    return { ...restored, orders: restored.orders.map(x => x.id === o.id ? { ...x, status: next, stockDeducted: false } : x) }
  }

  return { ...s, orders: s.orders.map(x => x.id === o.id ? { ...x, status: next } : x) }
}

export const applyOrderStatusTransition=(s:AppState,o:Order,next:OrderStatus):AppState|null=>changeOrderStatus(s,o,next)

export const updatePackedItem=(s:AppState,id:string,key:keyof PackedChecks,value:boolean):AppState|null=>{
  const current=s.orders.find(o=>o.id===id)
  if(!current||current.stockDeducted||current.status==='Чека залиха')return s
  const updated={...current,packed:{...current.packed,[key]:value}}
  const next={...s,orders:s.orders.map(o=>o.id===id?updated:o)}
  return allPacked(updated)&&reservingStatuses.has(updated.status)?deductOrderStock(next,updated,'Спакувана'):next
}
const baselineReceiptLine=(date:string,product:ProductKey,packages:number,pieces:number):Movement=>({id:`baseline-pr-0001-${product}`,date,product,type:'Влез',packages,pieces,party:'Почетна состојба',orderNumber:'PR-0001',note:'Почетна залиха'})
export const ensureDocumentArchive=(state:AppState):AppState=>{
 const existing=state.movements.filter(m=>m.orderNumber==='PR-0001')
 const now=new Date();const date=existing[0]?.date||`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`
 const baseline=[baselineReceiptLine(date,'p025',150,0),baselineReceiptLine(date,'p15',86,0),baselineReceiptLine(date,'flyers',0,2500)]
 const legacy=state.movements.some(m=>/^PRI-\d{4}-\d+$/.test(m.orderNumber))
 if(existing.length>0&&!legacy)return state
 return {...state,movements:[...baseline,...state.movements.filter(m=>m.orderNumber!=='PR-0001'&&!/^PRI-\d{4}-\d+$/.test(m.orderNumber))]}
}
export const rebalanceReservations=(state:AppState):AppState=>{
 const capacity={p025:state.warehouse.p025.total,p15:state.warehouse.p15.total,flyers:state.warehouse.flyers}
 const decisions=new Map<string,OrderStatus>()
 state.orders.filter(order=>reservingStatuses.has(order.status)&&!order.stockDeducted).toSorted((a,b)=>a.date.localeCompare(b.date)||a.number.localeCompare(b.number)).forEach(order=>{const need=orderPieces(order),fits=need.p025<=capacity.p025&&need.p15<=capacity.p15&&need.flyers<=capacity.flyers;if(fits){capacity.p025-=need.p025;capacity.p15-=need.p15;capacity.flyers-=need.flyers}else decisions.set(order.id,'Чека залиха')})
 return decisions.size?{...state,orders:state.orders.map(order=>decisions.has(order.id)?{...order,status:'Чека залиха'}:order)}:state
}
export const hydrateState=(state:AppState)=>reconcileWaitingOrders(rebalanceReservations(ensureDocumentArchive({...state,stockThresholds:state.stockThresholds||{p025:300,p15:60,flyers:500},orders:state.orders.map(o=>{const {scannedPackages:_removed,...clean}=o as Order&{scannedPackages?:unknown};void _removed;const hydrated={...clean,qty025Pieces:clean.qty025Pieces||0,qty15Pieces:clean.qty15Pieces||0,free025Pieces:clean.free025Pieces||0,free15:clean.free15||0,free15Pieces:clean.free15Pieces||0,packed:{...clean.packed,free15:clean.packed.free15||false}};const packed=reservingStatuses.has(hydrated.status)&&allPacked(hydrated)?{...hydrated,status:'Спакувана' as const}:hydrated;const legacyDeducted=deductStatuses.has(packed.status)&&!packed.stockDeducted?{...packed,stockDeducted:true}:packed;return legacyDeducted.status==='Чека залиха'&&legacyDeducted.stockDeducted?{...legacyDeducted,stockDeducted:false}:legacyDeducted})})))

export const reserved=(s:AppState)=>{
  const snapshot=calculateWarehouseSnapshot(s)
  return snapshot.reserved_stock
}

export const available=(s:AppState)=>{
  const snapshot=calculateWarehouseSnapshot(s)
  return snapshot.available_stock
}

export const reservationShortage=(s:AppState,o:Order)=>{
  const free=available(s)
  const need=orderPieces(o)
  return {p025:Math.max(0,need.p025-Math.max(0,free.p025)),p15:Math.max(0,need.p15-Math.max(0,free.p15)),flyers:Math.max(0,need.flyers-Math.max(0,free.flyers))}
}
export const canReserveOrder=(s:AppState,o:Order)=>Object.values(reservationShortage(s,o)).every(value=>value===0)
export const canReplaceOrder=(s:AppState,original:Order,replacement:Order)=>{const base={...s,orders:s.orders.filter(order=>order.id!==original.id)},before=reservationShortage(base,original),after=reservationShortage(base,replacement);return (['p025','p15','flyers'] as const).every(product=>after[product]<=before[product])}
export const waitingDemand=(s:AppState)=>s.orders.filter(order=>order.status==='Чека залиха').reduce((total,order)=>{const need=orderPieces(order);return {p025:total.p025+need.p025,p15:total.p15+need.p15,flyers:total.flyers+need.flyers}},{p025:0,p15:0,flyers:0})
export const reconcileWaitingOrders=(s:AppState)=>s.orders.filter(order=>order.status==='Чека залиха').toSorted((a,b)=>a.date.localeCompare(b.date)||a.number.localeCompare(b.number)).reduce<AppState>((current,waiting)=>canReserveOrder(current,waiting)?{...current,orders:current.orders.map(order=>order.id===waiting.id?{...order,status:'Нова' as const}:order)}:current,s)
export const productName=(p:ProductKey)=>p==='p025'?'Шише 0.250 мл':p==='p15'?'БиБ 1,5 Л':'Флаери'

import type { AppState, Movement, Order, OrderStatus, PackedChecks, ProductKey, StockUnit } from '../types'
export const normalize=(total:number,perPackage:number):StockUnit=>({packages:Math.floor(total/perPackage),pieces:total%perPackage,total,perPackage})
export const breakdown=(packages:number,pieces=0)=>`${packages} пак. + ${pieces} пар.`
export const orderPieces=(o:Order)=>({p025:(o.qty025+o.free025)*15+(o.qty025Pieces||0)+(o.free025Pieces||0),p15:(o.qty15+(o.free15||0))*6+(o.qty15Pieces||0)+(o.free15Pieces||0),flyers:o.flyers})
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
}
export const deductOrderStock=(s:AppState,o:Order,status=o.status):AppState|null=>{if(o.stockDeducted)return {...s,orders:s.orders.map(x=>x.id===o.id?{...x,status}:x)};const need=orderPieces(o);if(s.warehouse.p025.total<need.p025||s.warehouse.p15.total<need.p15||s.warehouse.flyers<need.flyers)return null;const date=new Date().toISOString().slice(0,10);return {...s,warehouse:{p025:normalize(s.warehouse.p025.total-need.p025,15),p15:normalize(s.warehouse.p15.total-need.p15,6),flyers:s.warehouse.flyers-need.flyers},orders:s.orders.map(x=>x.id===o.id?{...x,status,stockDeducted:true}:x),movements:[...s.movements,{id:crypto.randomUUID(),date,product:'p025',type:'Излез',packages:o.qty025+o.free025,pieces:(o.qty025Pieces||0)+(o.free025Pieces||0),party:o.client,orderNumber:o.number,note:'Автоматско одземање при пакување'},{id:crypto.randomUUID(),date,product:'p15',type:'Излез',packages:o.qty15+(o.free15||0),pieces:(o.qty15Pieces||0)+(o.free15Pieces||0),party:o.client,orderNumber:o.number,note:'Автоматско одземање при пакување'},{id:crypto.randomUUID(),date,product:'flyers',type:'Излез',packages:0,pieces:o.flyers,party:o.client,orderNumber:o.number,note:'Автоматско одземање при пакување'}]}}
export const returnOrderStock=(s:AppState,o:Order):AppState=>{if(!o.stockDeducted)return {...s,orders:s.orders.map(x=>x.id===o.id?{...x,status:'Откажана'}:x)};const need=orderPieces(o);const date=new Date().toISOString().slice(0,10);return {...s,warehouse:{p025:normalize(s.warehouse.p025.total+need.p025,15),p15:normalize(s.warehouse.p15.total+need.p15,6),flyers:s.warehouse.flyers+need.flyers},orders:s.orders.map(x=>x.id===o.id?{...x,status:'Откажана',stockDeducted:false}:x),movements:[...s.movements,{id:crypto.randomUUID(),date,product:'p025',type:'Враќање',packages:o.qty025+o.free025,pieces:(o.qty025Pieces||0)+(o.free025Pieces||0),party:o.client,orderNumber:o.number,note:'Автоматско враќање при откажување'},{id:crypto.randomUUID(),date,product:'p15',type:'Враќање',packages:o.qty15+(o.free15||0),pieces:(o.qty15Pieces||0)+(o.free15Pieces||0),party:o.client,orderNumber:o.number,note:'Автоматско враќање при откажување'},{id:crypto.randomUUID(),date,product:'flyers',type:'Враќање',packages:0,pieces:o.flyers,party:o.client,orderNumber:o.number,note:'Автоматско враќање при откажување'}]}}
export const updatePackedItem=(s:AppState,id:string,key:keyof PackedChecks,value:boolean):AppState|null=>{const current=s.orders.find(o=>o.id===id);if(!current||current.stockDeducted||current.status==='Чека залиха')return s;const updated={...current,packed:{...current.packed,[key]:value}};const next={...s,orders:s.orders.map(o=>o.id===id?updated:o)};return allPacked(updated)&&reservingStatuses.has(updated.status)?deductOrderStock(next,updated,'Спакувана'):next}
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
export const hydrateState=(state:AppState):AppState=>rebalanceReservations(ensureDocumentArchive({...state,stockThresholds:state.stockThresholds||{p025:300,p15:60,flyers:500},orders:state.orders.map(o=>{const {scannedPackages:_removed,...clean}=o as Order&{scannedPackages?:unknown};void _removed;const hydrated={...clean,qty025Pieces:clean.qty025Pieces||0,qty15Pieces:clean.qty15Pieces||0,free025Pieces:clean.free025Pieces||0,free15:clean.free15||0,free15Pieces:clean.free15Pieces||0,packed:{...clean.packed,free15:clean.packed.free15||false}};const packed=reservingStatuses.has(hydrated.status)&&allPacked(hydrated)?{...hydrated,status:'Спакувана' as const}:hydrated;return deductStatuses.has(packed.status)&&!packed.stockDeducted?{...packed,stockDeducted:true}:packed})}))
export const reserved=(s:AppState)=>s.orders.filter(o=>reservingStatuses.has(o.status)&&!o.stockDeducted).reduce((a,o)=>{const q=orderPieces(o);return {p025:a.p025+q.p025,p15:a.p15+q.p15,flyers:a.flyers+q.flyers}},{p025:0,p15:0,flyers:0})
export const available=(s:AppState)=>{const r=reserved(s);return {p025:s.warehouse.p025.total-r.p025,p15:s.warehouse.p15.total-r.p15,flyers:s.warehouse.flyers-r.flyers}}
export const reservationShortage=(s:AppState,o:Order)=>{const free=available(s),need=orderPieces(o);return {p025:Math.max(0,need.p025-Math.max(0,free.p025)),p15:Math.max(0,need.p15-Math.max(0,free.p15)),flyers:Math.max(0,need.flyers-Math.max(0,free.flyers))}}
export const canReserveOrder=(s:AppState,o:Order)=>Object.values(reservationShortage(s,o)).every(value=>value===0)
export const canReplaceOrder=(s:AppState,original:Order,replacement:Order)=>{const base={...s,orders:s.orders.filter(order=>order.id!==original.id)},before=reservationShortage(base,original),after=reservationShortage(base,replacement);return (['p025','p15','flyers'] as const).every(product=>after[product]<=before[product])}
export const waitingDemand=(s:AppState)=>s.orders.filter(order=>order.status==='Чека залиха').reduce((total,order)=>{const need=orderPieces(order);return {p025:total.p025+need.p025,p15:total.p15+need.p15,flyers:total.flyers+need.flyers}},{p025:0,p15:0,flyers:0})
export const reconcileWaitingOrders=(s:AppState)=>s.orders.filter(order=>order.status==='Чека залиха').toSorted((a,b)=>a.date.localeCompare(b.date)||a.number.localeCompare(b.number)).reduce<AppState>((current,waiting)=>canReserveOrder(current,waiting)?{...current,orders:current.orders.map(order=>order.id===waiting.id?{...order,status:'Нова' as const}:order)}:current,s)
export const productName=(p:ProductKey)=>p==='p025'?'Шише 0.250 мл':p==='p15'?'БиБ 1,5 Л':'Флаери'

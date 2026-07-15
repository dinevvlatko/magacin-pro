import type { AppState, Movement, Order, PackedChecks, ProductKey, StockUnit } from '../types'
export const normalize=(total:number,perPackage:number):StockUnit=>({packages:Math.floor(total/perPackage),pieces:total%perPackage,total,perPackage})
export const breakdown=(packages:number,pieces=0)=>`${packages} пак. + ${pieces} пар.`
export const orderPieces=(o:Order)=>({p025:(o.qty025+o.free025)*15+(o.qty025Pieces||0)+(o.free025Pieces||0),p15:o.qty15*6+(o.qty15Pieces||0),flyers:o.flyers})
export const allPacked=(o:Order)=>o.packed.regular025&&o.packed.bib15&&o.packed.free025&&o.packed.flyers
export const deductStatuses=new Set(['Спакувана','Излезена','Испратена','Доставена'])
export const activeStatuses=new Set(['Нова','Во подготовка'])
export const deductOrderStock=(s:AppState,o:Order,status=o.status):AppState|null=>{if(o.stockDeducted)return {...s,orders:s.orders.map(x=>x.id===o.id?{...x,status}:x)};const need=orderPieces(o);if(s.warehouse.p025.total<need.p025||s.warehouse.p15.total<need.p15||s.warehouse.flyers<need.flyers)return null;const date=new Date().toISOString().slice(0,10);return {...s,warehouse:{p025:normalize(s.warehouse.p025.total-need.p025,15),p15:normalize(s.warehouse.p15.total-need.p15,6),flyers:s.warehouse.flyers-need.flyers},orders:s.orders.map(x=>x.id===o.id?{...x,status,stockDeducted:true}:x),movements:[...s.movements,{id:crypto.randomUUID(),date,product:'p025',type:'Излез',packages:o.qty025+o.free025,pieces:(o.qty025Pieces||0)+(o.free025Pieces||0),party:o.client,orderNumber:o.number,note:'Автоматско одземање при пакување'},{id:crypto.randomUUID(),date,product:'p15',type:'Излез',packages:o.qty15,pieces:o.qty15Pieces||0,party:o.client,orderNumber:o.number,note:'Автоматско одземање при пакување'},{id:crypto.randomUUID(),date,product:'flyers',type:'Излез',packages:0,pieces:o.flyers,party:o.client,orderNumber:o.number,note:'Автоматско одземање при пакување'}]}}
export const updatePackedItem=(s:AppState,id:string,key:keyof PackedChecks,value:boolean):AppState|null=>{const current=s.orders.find(o=>o.id===id);if(!current||current.stockDeducted)return s;const updated={...current,packed:{...current.packed,[key]:value}};const next={...s,orders:s.orders.map(o=>o.id===id?updated:o)};return allPacked(updated)&&activeStatuses.has(updated.status)?deductOrderStock(next,updated,'Спакувана'):next}
const baselineReceiptLine=(date:string,product:ProductKey,packages:number,pieces:number):Movement=>({id:`baseline-pr-0001-${product}`,date,product,type:'Влез',packages,pieces,party:'Почетна состојба',orderNumber:'PR-0001',note:'Почетна залиха'})
export const ensureDocumentArchive=(state:AppState):AppState=>{
 const existing=state.movements.filter(m=>m.orderNumber==='PR-0001')
 const now=new Date();const date=existing[0]?.date||`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`
 const baseline=[baselineReceiptLine(date,'p025',150,0),baselineReceiptLine(date,'p15',86,0),baselineReceiptLine(date,'flyers',0,2500)]
 const expected=new Map<ProductKey,[number,number]>([['p025',[150,0]],['p15',[86,0]],['flyers',[0,2500]]])
 const legacy=state.movements.some(m=>/^PRI-\d{4}-\d+$/.test(m.orderNumber))
 const current=existing.length===baseline.length&&existing.every(line=>{const quantity=expected.get(line.product);return quantity&&line.type==='Влез'&&line.packages===quantity[0]&&line.pieces===quantity[1]&&line.party==='Почетна состојба'&&line.note==='Почетна залиха'})
 if(current&&!legacy)return state
 return {...state,movements:[...baseline,...state.movements.filter(m=>m.orderNumber!=='PR-0001'&&!/^PRI-\d{4}-\d+$/.test(m.orderNumber))]}
}
export const hydrateState=(state:AppState):AppState=>ensureDocumentArchive({...state,orders:state.orders.map(o=>{const hydrated={...o,qty025Pieces:o.qty025Pieces||0,qty15Pieces:o.qty15Pieces||0,free025Pieces:o.free025Pieces||0};return activeStatuses.has(hydrated.status)&&allPacked(hydrated)?{...hydrated,status:'Спакувана'}:hydrated})})
export const reserved=(s:AppState)=>s.orders.filter(o=>activeStatuses.has(o.status)&&!o.stockDeducted).reduce((a,o)=>{const q=orderPieces(o);return {p025:a.p025+q.p025,p15:a.p15+q.p15,flyers:a.flyers+q.flyers}},{p025:0,p15:0,flyers:0})
export const available=(s:AppState)=>{const r=reserved(s);return {p025:s.warehouse.p025.total-r.p025,p15:s.warehouse.p15.total-r.p15,flyers:s.warehouse.flyers-r.flyers}}
export const productName=(p:ProductKey)=>p==='p025'?'Шише 0.250 мл':p==='p15'?'БиБ 1,5 Л':'Флаери'

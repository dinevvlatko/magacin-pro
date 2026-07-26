import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { ArchiveRestore, ArrowLeftRight, CheckCircle2, ChevronRight, CirclePlus, Cloud, CloudOff, Eye, FileText, LogIn, LogOut, Package, Pencil, Printer, QrCode, RotateCcw, Search, Send, ShieldCheck, Trash2, Truck, Warehouse as WarehouseIcon } from 'lucide-react'
import type { AppState, MovementType, Order, OrderStatus, ProductKey, StockThresholds } from './types'
import { demoState, makeOrderNumber } from './lib/data'
import { activeStatuses, allowedTransitions, allPacked, available, breakdown, canReserveOrder, deductOrderStock, deductStatuses, hydrateState, normalize, productName, reconcileWaitingOrders, reservationShortage, reserved, returnOrderStock, updatePackedItem } from './lib/logic'
import { supabase, syncEnabled } from './lib/supabase'
import { useSyncedState, type SyncStatus } from './lib/useSyncedState'
import { appVersion } from './pwa'
import { BottomNav, SideNav } from './components/Nav'
import { BrandLockup, BrandMark } from './components/Brand'
import { Card, Empty, Field, Modal, PageHeader } from './components/UI'
import { AdminPage } from './components/AdminPage'
import { ClientsPage } from './components/ClientsPage'
import { shareOrderPdf } from './lib/orderPdf'
import { formatDocumentDate } from './lib/date'
import { createOrderQrDataUrl } from './lib/orderQr'
import { orderReportTotals } from './lib/orderReport'
import { createReceiptAtomic, loadReceiptModule, receiptItemUnits, ReceiptSchemaMissingError, ReceiptValidationError, updateReceiptAtomic, validateReceiptItems, type ProductRecord, type ReceiptInput, type ReceiptItemDraft, type ReceiptRecord } from './lib/receipts'
import './index.css'

const statusClass=(s:OrderStatus)=>`status ${s.replaceAll(' ','-').toLowerCase()}`
const todayLocal=()=>{const date=new Date();return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`}
const packingNumber=(order:Order)=>order.number.replace(/^PG-/, 'SP-')
const localDemo=import.meta.env.DEV&&new URLSearchParams(window.location.search).has('local-demo')
const localMode=!syncEnabled||localDemo
type ReceiptModuleStatus='loading'|'ready'|'missing'|'error'

function App(){
 const {state,setState,session,profile,authReady,syncStatus,syncError,recordAudit}=useSyncedState()
 const [page,setPage]=useState('dashboard')
 const [selected,setSelected]=useState<string|null>(null)
 const [showOrder,setShowOrder]=useState(false)
 const [editingOrderId,setEditingOrderId]=useState<string|null>(null)
 const [showEntry,setShowEntry]=useState(false)
 const [showReceipt,setShowReceipt]=useState(false)
 const [editingReceipt,setEditingReceipt]=useState<ReceiptRecord|null>(null)
 const [receiptToPrint,setReceiptToPrint]=useState<ReceiptRecord|null>(null)
 const [products,setProducts]=useState<ProductRecord[]>([])
 const [receipts,setReceipts]=useState<ReceiptRecord[]>([])
 const [receiptModuleStatus,setReceiptModuleStatus]=useState<ReceiptModuleStatus>('loading')
 const [receiptModuleError,setReceiptModuleError]=useState('')
 const [printMode,setPrintMode]=useState<'packing'|'receipt'|'order-report'>('packing')
 const [printQrDataUrl,setPrintQrDataUrl]=useState('')
 const [reportOrders,setReportOrders]=useState<Order[]>([])
 const [reportFilter,setReportFilter]=useState('')
 const [query,setQuery]=useState('')
 const [linkedOrderId]=useState(()=>new URLSearchParams(window.location.search).get('order'))
 const [linkedOrderHandled,setLinkedOrderHandled]=useState(false)
 const selectedOrder=state.orders.find(o=>o.id===selected)||null
 const editingOrder=state.orders.find(o=>o.id===editingOrderId)||null
 const r=useMemo(()=>reserved(state),[state]); const a=useMemo(()=>available(state),[state])
 const isAdmin=profile?.role==='admin'
 const refreshReceipts=useCallback(async()=>{
  const module=await loadReceiptModule()
  setProducts(module.products);setReceipts(module.receipts);setReceiptModuleStatus('ready');setReceiptModuleError('')
 },[])
 useEffect(()=>{
  if(!session){if(localMode){setReceiptModuleStatus('missing');setReceiptModuleError('Atomic приемниците работат само со Phase 1 Supabase табелите.')}return}
  let active=true
  setReceiptModuleStatus('loading')
  void refreshReceipts().catch(error=>{
   if(!active)return
   if(error instanceof ReceiptSchemaMissingError){setReceiptModuleStatus('missing');setReceiptModuleError(`${error.message} Пушти ја migration: supabase/phase1_receipts.sql`)}
   else{setReceiptModuleStatus('error');setReceiptModuleError(error instanceof Error?error.message:'Не може да се вчитаат приемниците.')}
  })
  return()=>{active=false}
 },[refreshReceipts,session])
 useEffect(()=>{if(linkedOrderHandled||!linkedOrderId)return;const linked=state.orders.find(order=>order.id===linkedOrderId);if(linked){setSelected(linked.id);setPage('packing');setLinkedOrderHandled(true)}},[linkedOrderHandled,linkedOrderId,state.orders])
 if(!authReady&&!localMode)return <div className="auth-shell"><div className="auth-card"><BrandLockup/><p>Се поврзува со заедничката база...</p></div></div>
 if(!session&&!localMode)return <AuthScreen/>
 const patchPacked=(o:Order,key:keyof Order['packed'],value:boolean)=>{
  const updated=updatePackedItem(state,o.id,key,value)
  if(!updated){alert('Нема доволно залиха за оваа нарачка.');return}
  setState(updated)
  void recordAudit('order.packing_checked','order',o.id,{number:o.number,item:key,checked:value,auto_packed:updated.orders.find(order=>order.id===o.id)?.status==='Спакувана'&&o.status!=='Спакувана'})
 }
 const changeStatus=(o:Order,next:OrderStatus)=>{
  if(next===o.status)return
  if(!allowedTransitions[o.status].includes(next)){alert(`Не е дозволен директен премин од „${o.status}“ во „${next}“.`);return}
  if(next==='Спакувана'&&!allPacked(o)){alert('Прво означи ги сите ставки како спакувани.');return}
  if(o.status==='Чека залиха'&&next==='Нова'&&!canReserveOrder(state,o)){alert('Сè уште нема доволно слободна залиха за оваа нарачка.');return}
  if(next==='Откажана'){
   if(o.stockDeducted&&!confirm('Нарачката веќе е одземена од магацин. Со откажување, целата количина автоматски ќе се врати во залиха. Продолжи?'))return
   setState(reconcileWaitingOrders(returnOrderStock(state,o)));void recordAudit('order.cancelled','order',o.id,{number:o.number,from:o.status,stock_returned:o.stockDeducted});return
  }
  if(deductStatuses.has(next)&&!o.stockDeducted){const updated=deductOrderStock(state,o,next);if(!updated){alert('Нема доволно залиха за оваа нарачка.');return}setState(updated);void recordAudit('order.status_changed','order',o.id,{number:o.number,from:o.status,to:next});return}
  void recordAudit('order.status_changed','order',o.id,{number:o.number,from:o.status,to:next})
  setState(s=>({...s,orders:s.orders.map(order=>order.id===o.id?{...order,status:next}:order)}))
 }
 const advanceOrder=(o:Order)=>{
  if(o.status==='Чека залиха'){alert('Нарачката сè уште чека залиха и не може да продолжи.');return}
  if(o.status==='Нова'||o.status==='Во подготовка'){
   const confirmed={...o,packed:{regular025:true,bib15:true,free025:true,free15:true,flyers:true}}
   const staged={...state,orders:state.orders.map(order=>order.id===o.id?confirmed:order)}
   const updated=deductOrderStock(staged,confirmed,'Спакувана')
   if(!updated){alert('Нема доволно залиха за да се потврди целата нарачка.');return}
   setState(updated);void recordAudit('order.qr_status_advanced','order',o.id,{number:o.number,from:o.status,to:'Спакувана'});return
  }
  const next:Partial<Record<OrderStatus,OrderStatus>>={Спакувана:'Испратена',Излезена:'Испратена',Испратена:'Доставена'}
  const target=next[o.status]
  if(target){changeStatus(o,target);void recordAudit('order.qr_status_advanced','order',o.id,{number:o.number,from:o.status,to:target})}
 }
 const deleteOrder=(id:string)=>{const order=state.orders.find(item=>item.id===id);if(!order||!confirm('Да се избрише нарачката?'))return;setState(s=>({...s,orders:s.orders.filter(item=>item.id!==id)}));void recordAudit('order.deleted','order',id,{number:order.number,client:order.client})}
 const saveNewOrder=(o:Order)=>{const saved={...o,status:(canReserveOrder(state,o)?'Нова':'Чека залиха') as OrderStatus};setState(s=>({...s,orders:[saved,...s.orders],clients:s.clients.some(c=>c.name.toLowerCase()===saved.client.toLowerCase())?s.clients:[...s.clients,{id:crypto.randomUUID(),name:saved.client,city:saved.city,phone:'',contactPerson:'',address:''}]}));void recordAudit('order.created','order',saved.id,{number:saved.number,client:saved.client,city:saved.city,status:saved.status});setShowOrder(false)}
 const editOrder=(o:Order)=>{if(o.stockDeducted&&!isAdmin){alert('Само администратор може да менува нарачка откако залихата е одземена.');return}if(o.stockDeducted&&!confirm('Оваа нарачка е веќе спакувана. При зачувување, старата количина ќе се врати и исправената повторно ќе се одземе. Продолжи?'))return;setEditingOrderId(o.id)}
 const saveEditedOrder=(candidate:Order)=>{
  const original=state.orders.find(order=>order.id===candidate.id);if(!original)return
  const resetPacked={regular025:false,bib15:false,free025:false,free15:false,flyers:false}
  let corrected={...candidate,status:original.status,stockDeducted:false,packed:original.stockDeducted?{regular025:true,bib15:true,free025:true,free15:true,flyers:true}:resetPacked}
  let next:AppState
  if(original.stockDeducted){
   if(!isAdmin){alert('Само администратор може да ја направи оваа исправка.');return}
   const restored=returnOrderStock(state,original)
   const staged={...restored,orders:restored.orders.map(order=>order.id===original.id?corrected:order)}
   const rededucted=deductOrderStock(staged,corrected,original.status)
   if(!rededucted){alert('Исправката не може да се зачува бидејќи нема доволно залиха за новата количина.');return}
   next=rededucted
  }else{
   const withoutOriginal={...state,orders:state.orders.filter(order=>order.id!==original.id)}
   corrected={...corrected,status:canReserveOrder(withoutOriginal,corrected)?(original.status==='Чека залиха'?'Нова':original.status):'Чека залиха'}
   next={...state,orders:state.orders.map(order=>order.id===original.id?corrected:order)}
  }
  if(!next.clients.some(client=>client.name.trim().toLowerCase()===corrected.client.trim().toLowerCase()))next={...next,clients:[...next.clients,{id:crypto.randomUUID(),name:corrected.client,city:corrected.city,phone:'',contactPerson:'',address:''}]}
  setState(next);setEditingOrderId(null)
  void recordAudit('order.corrected','order',original.id,{number:original.number,from:`${original.client}; 0.25=${original.qty025}+${original.free025}; BiB=${original.qty15}+${original.free15||0}; flyers=${original.flyers}`,to:`${corrected.client}; 0.25=${corrected.qty025}+${corrected.free025}; BiB=${corrected.qty15}+${corrected.free15||0}; flyers=${corrected.flyers}`,stock_recalculated:original.stockDeducted})
 }
 const saveStockEntry=(p:ProductKey,t:MovementType,pack:number,pieces:number,party:string,note:string,date:string)=>{const delta=(t==='Излез'||t==='Оштетување')?-1:1;const total=p==='p025'?pack*15+pieces:p==='p15'?pack*6+pieces:pieces;const current=p==='p025'?state.warehouse.p025.total:p==='p15'?state.warehouse.p15.total:state.warehouse.flyers;if(current+delta*total<0){alert('Не е дозволена негативна залиха.');return}setState(s=>reconcileWaitingOrders({...s,warehouse:p==='p025'?{...s.warehouse,p025:normalize(s.warehouse.p025.total+delta*total,15)}:p==='p15'?{...s.warehouse,p15:normalize(s.warehouse.p15.total+delta*total,6)}:{...s.warehouse,flyers:s.warehouse.flyers+delta*total},movements:[{id:crypto.randomUUID(),date,product:p,type:t,packages:pack,pieces,party,orderNumber:'',note},...s.movements]}));void recordAudit('stock.movement','stock',p,{type:t,packages:pack,pieces,party});setShowEntry(false)}
 const saveReceipt=async(input:ReceiptInput)=>{
  const saved=editingReceipt
   ?await updateReceiptAtomic(editingReceipt.id,input,products)
   :await createReceiptAtomic(input,products)
  await refreshReceipts()
  void recordAudit(editingReceipt?'stock.receipt_updated':'stock.receipt_created','receipt',saved.id,{number:saved.number,items:input.items.length,workers:input.workersTeam})
  setShowReceipt(false);setEditingReceipt(null)
 }
 const printOrder=async(o:Order)=>{setSelected(o.id);setPrintMode('packing');setPrintQrDataUrl(await createOrderQrDataUrl(o.id));setTimeout(()=>window.print(),100)}
 const printReceipt=(receipt:ReceiptRecord)=>{setReceiptToPrint(receipt);setPrintMode('receipt');setPrintQrDataUrl('');setTimeout(()=>window.print(),50)}
 const openNewReceipt=()=>{if(receiptModuleStatus!=='ready'){alert(receiptModuleError||'Приемниците сè уште се вчитуваат.');return}setEditingReceipt(null);setShowReceipt(true)}
 const openEditReceipt=(receipt:ReceiptRecord)=>{setEditingReceipt(receipt);setShowReceipt(true)}
 const printOrderReport=(orders:Order[],filterLabel:string)=>{if(!orders.length){alert('Нема нарачки за печатење.');return}setReportOrders(orders);setReportFilter(filterLabel);setPrintMode('order-report');setPrintQrDataUrl('');setTimeout(()=>window.print(),50)}
 return <div className="app"><SideNav page={page} setPage={setPage} isAdmin={isAdmin}/><main className="main">
  {page==='dashboard'&&<Dashboard state={state} r={r} a={a} setPage={setPage} openOrder={id=>{setSelected(id);setPage('packing')}} openPacked={()=>{setSelected(state.orders.find(o=>o.status==='Спакувана')?.id||null);setPage('packing')}}/>}
  {page==='orders'&&<Orders state={state} query={query} setQuery={setQuery} onOpen={id=>{setSelected(id);setPage('packing')}} onNew={()=>setShowOrder(true)} onEdit={editOrder} onDelete={isAdmin?deleteOrder:undefined} onPrintReport={printOrderReport}/>}
  {page==='packing'&&<Packing order={selectedOrder||state.orders[0]||null} onSelect={setSelected} orders={state.orders} patchPacked={patchPacked} changeStatus={changeStatus} advanceOrder={advanceOrder} printOrder={printOrder} onEdit={editOrder} fromQr={Boolean(linkedOrderId&&selectedOrder?.id===linkedOrderId)}/>}
  {page==='warehouse'&&<WarehousePage state={state} receipts={receipts} receiptStatus={receiptModuleStatus} receiptError={receiptModuleError} onEntry={()=>setShowEntry(true)} onReceipt={openNewReceipt} onEditReceipt={openEditReceipt}/>}
  {page==='clients'&&<ClientsPage state={state}/>}
  {page==='movements'&&<MovementsPage state={state}/>}
  {page==='printing'&&<PrintingPage state={state} receipts={receipts} receiptStatus={receiptModuleStatus} receiptError={receiptModuleError} printOrder={printOrder} printReceipt={printReceipt} onEditReceipt={openEditReceipt}/>}
  {page==='admin'&&isAdmin&&session&&<AdminPage currentUserId={session.user.id}/>}
  {page==='settings'&&<SettingsPage
   syncStatus={syncStatus}
   syncError={syncError}
   email={session?.user.email||'Локален тест'}
   role={profile?.role||'operator'}
   isAdmin={isAdmin}
   thresholds={state.stockThresholds||{p025:300,p15:60,flyers:500}}
   onThresholds={isAdmin?thresholds=>{setState(s=>({...s,stockThresholds:thresholds}));void recordAudit('stock.thresholds_changed','stock',null,{...thresholds})}:undefined}
   openAdmin={()=>setPage('admin')}
   onReset={isAdmin?()=>{if(confirm('Да се вратат демо податоците? Сите тековни податоци ќе се избришат.')){setState(hydrateState(demoState()));setSelected(null);void recordAudit('app.demo_reset','app',null,{})}}:undefined}
  />}
 </main><BottomNav page={page} setPage={setPage}/>
 {showOrder&&<NewOrder state={state} onClose={()=>setShowOrder(false)} onSave={saveNewOrder}/>}
 {editingOrder&&<EditOrder state={state} order={editingOrder} onClose={()=>setEditingOrderId(null)} onSave={saveEditedOrder}/>}
 {showEntry&&<StockEntry onClose={()=>setShowEntry(false)} onSave={saveStockEntry}/>}
 {showReceipt&&<ReceiptEntry products={products} initial={editingReceipt} onClose={()=>{setShowReceipt(false);setEditingReceipt(null)}} onSave={saveReceipt}/>}
 <div className="print-only">{printMode==='packing'&&selectedOrder?<PackingPrint o={selectedOrder} qrDataUrl={printQrDataUrl}/>:printMode==='receipt'&&receiptToPrint?<ReceiptPrint receipt={receiptToPrint}/>:printMode==='order-report'?<OrderReportPrint orders={reportOrders} filterLabel={reportFilter}/>:null}</div>
 </div>
}

function AuthScreen(){
 const [fullName,setFullName]=useState('')
 const [email,setEmail]=useState('')
 const [password,setPassword]=useState('')
 const [mode,setMode]=useState<'login'|'signup'>('login')
 const [busy,setBusy]=useState(false)
 const [message,setMessage]=useState('')
 const submit=async(e:FormEvent)=>{
  e.preventDefault();setBusy(true);setMessage('')
  const result=mode==='login'
   ?await supabase.auth.signInWithPassword({email,password})
   :await supabase.auth.signUp({email,password,options:{data:{full_name:fullName.trim()}}})
  setBusy(false)
  if(result.error){setMessage(result.error.message);return}
  if(mode==='signup'&&!result.data.session)setMessage('Провери ја е-поштата и потврди ја регистрацијата, па најави се.')
 }
 return <div className="auth-shell"><form className="auth-card" onSubmit={submit}><BrandLockup/><h1>{mode==='login'?'Најава':'Нов профил'}</h1><p>Секој вработен користи свој профил, а сите работат во истиот заеднички магацин.</p>{mode==='signup'&&<label>Име и презиме<input required autoComplete="name" value={fullName} onChange={e=>setFullName(e.target.value)}/></label>}<label>Е-пошта<input type="email" required autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Лозинка<input type="password" required minLength={6} autoComplete={mode==='login'?'current-password':'new-password'} value={password} onChange={e=>setPassword(e.target.value)}/></label>{message&&<div className="auth-message">{message}</div>}<button className="primary auth-submit" disabled={busy}><LogIn size={18}/>{busy?'Почекај...':mode==='login'?'Најави се':'Регистрирај се'}</button><button type="button" className="auth-switch" onClick={()=>{setMode(mode==='login'?'signup':'login');setMessage('')}}>{mode==='login'?'Немаш профил? Регистрирај се':'Имаш профил? Најави се'}</button></form></div>
}

function Dashboard({state,r,a,setPage,openOrder,openPacked}:{state:AppState;r:any;a:any;setPage:(p:string)=>void;openOrder:(id:string)=>void;openPacked:()=>void}){const packed=state.orders.filter(o=>o.status==='Спакувана').length,sent=state.orders.filter(o=>['Излезена','Испратена','Доставена'].includes(o.status)).length,waiting=state.orders.filter(o=>o.status==='Чека залиха').length,t=state.stockThresholds||{p025:300,p15:60,flyers:500};return <><PageHeader title="Контролна табла" action={<button className="primary" onClick={()=>setPage('orders')}><CirclePlus size={18}/> Нова нарачка</button>}/><div className="hero k2-hero"><div className="hero-copy"><div className="k2-hero-lockup"><BrandMark/><div><h2>K2 Vita</h2><p>Пакувај. Следи. Испорачај.</p></div></div><div className="hero-flow" aria-label="Нарачка, пакување, магацин, испорака"><span><i/>Нарачка</span><b>→</b><span><i/>Пакување</span><b>→</b><span><i/>Магацин</span><b>→</b><span><i/>Испорака</span></div></div><div className="pulse"><i/> Системот е активен</div></div><div className="stock-grid"><StockCard title={productName('p025')} packs={state.warehouse.p025.packages} pieces={state.warehouse.p025.pieces} total={state.warehouse.p025.total} reserved={r.p025} available={a.p025} threshold={t.p025} onClick={()=>setPage('warehouse')}/><StockCard title={productName('p15')} packs={state.warehouse.p15.packages} pieces={state.warehouse.p15.pieces} total={state.warehouse.p15.total} reserved={r.p15} available={a.p15} threshold={t.p15} onClick={()=>setPage('warehouse')}/><StockCard title="Флаери" packs={0} pieces={state.warehouse.flyers} total={state.warehouse.flyers} reserved={r.flyers} available={a.flyers} threshold={t.flyers} onClick={()=>setPage('warehouse')}/></div><LowStockAlerts state={state}/><div className="metric-grid"><Metric label="Активни нарачки" value={state.orders.filter(o=>activeStatuses.has(o.status)).length} onClick={()=>setPage('orders')}/><Metric label="Чекаат залиха" value={waiting} onClick={()=>setPage('orders')}/><Metric label="Спакувани" value={packed} onClick={openPacked}/><Metric label="Испратени/излезени" value={sent} onClick={()=>setPage('movements')}/></div><Card><div className="section-title"><div><h3>Следни за пакување</h3><p>Нарачките што чекаат залиха се прикажани први</p></div><button className="ghost" onClick={()=>setPage('packing')}>Отвори пакување <ChevronRight size={16}/></button></div><div className="compact-list">{state.orders.filter(o=>activeStatuses.has(o.status)).toSorted((x,y)=>(x.status==='Чека залиха'?0:1)-(y.status==='Чека залиха'?0:1)).slice(0,5).map(o=><button type="button" key={o.id} onClick={()=>openOrder(o.id)}><span><strong>{o.client}</strong><small>{o.city} • {o.number}</small></span><span className={statusClass(o.status)}>{o.status}</span></button>)}</div></Card></>}
const StockCard=({title,packs,pieces,total,reserved,available,threshold=0,onClick}:{title:string;packs:number;pieces:number;total:number;reserved:number;available:number;threshold?:number;onClick?:()=>void})=>{const free=Math.max(0,available),low=free<=threshold,content=<><div className="stock-icon"><Package/></div><div className="stock-top"><h3>{title}</h3><strong>{total}</strong></div><div className="stock-split"><span><b>{packs}</b> пакети</span><span><b>{pieces}</b> парчиња</span></div><div className="bar"><i style={{width:`${Math.min(100,total?reserved/total*100:0)}%`}}/></div><div className="stock-foot"><span>Резервирано: <b>{reserved}</b></span><span>Слободно: <b>{free}</b></span></div>{low&&<div className="stock-shortage">Ниска слободна залиха • праг {threshold}</div>}</>;return onClick?<button type="button" className={`card stock-card dashboard-link${low?' low-stock':''}`} onClick={onClick}>{content}</button>:<Card className={`stock-card${low?' low-stock':''}`}>{content}</Card>}
function LowStockAlerts({state}:{state:AppState}){const t=state.stockThresholds||{p025:300,p15:60,flyers:500},free=available(state),items=[[productName('p025'),Math.max(0,free.p025),t.p025],[productName('p15'),Math.max(0,free.p15),t.p15],[productName('flyers'),Math.max(0,free.flyers),t.flyers]] as const,low=items.filter(item=>item[1]<=item[2]);if(!low.length)return null;return <div className="low-stock-alerts">{low.map(([name,total,threshold])=><a key={name} href={`viber://forward?text=${encodeURIComponent(`⚠️ Ниска слободна залиха: ${name} има ${total}, минимален праг ${threshold}.`)}`}><Send size={16}/>{name}: {total} слободни • Извести на Viber</a>)}</div>}
const Metric=({label,value,onClick}:{label:string;value:number;onClick?:()=>void})=>onClick?<button type="button" className="card metric dashboard-link" onClick={onClick}><span>{label}</span><strong>{value}</strong></button>:<Card className="metric"><span>{label}</span><strong>{value}</strong></Card>

function Orders({state,query,setQuery,onOpen,onNew,onEdit,onDelete,onPrintReport}:{state:AppState;query:string;setQuery:(v:string)=>void;onOpen:(id:string)=>void;onNew:()=>void;onEdit:(o:Order)=>void;onDelete?:(id:string)=>void;onPrintReport:(orders:Order[],filterLabel:string)=>void}){
 const [statusFilter,setStatusFilter]=useState<'all'|'Чека залиха'|'Нова'|'Во подготовка'>('all')
 const [selectedIds,setSelectedIds]=useState<Set<string>>(()=>new Set())
 const list=state.orders
  .filter(order=>activeStatuses.has(order.status))
  .filter(order=>statusFilter==='all'||order.status===statusFilter)
  .filter(order=>(order.client+' '+order.city+' '+order.number).toLowerCase().includes(query.toLowerCase()))
  .toSorted((a,b)=>(a.status==='Чека залиха'?0:1)-(b.status==='Чека залиха'?0:1)||a.date.localeCompare(b.date))
 const selected=list.filter(order=>selectedIds.has(order.id))
 const allVisibleSelected=list.length>0&&list.every(order=>selectedIds.has(order.id))
 const toggle=(id:string)=>setSelectedIds(current=>{const next=new Set(current);if(next.has(id))next.delete(id);else next.add(id);return next})
 const toggleAll=()=>setSelectedIds(current=>{const next=new Set(current);if(allVisibleSelected)list.forEach(order=>next.delete(order.id));else list.forEach(order=>next.add(order.id));return next})
 const filterLabel=`Статус: ${statusFilter==='all'?'Сите активни':statusFilter}${query.trim()?` • Пребарување: ${query.trim()}`:''}`
 return <><PageHeader title="Активни нарачки" action={<button className="primary" onClick={onNew}><CirclePlus size={18}/> Нова нарачка</button>}/>
  <div className="toolbar orders-toolbar">
   <div className="search"><Search size={18}/><input placeholder="Пребарај клиент, град или број..." value={query} onChange={e=>setQuery(e.target.value)}/></div>
   <select aria-label="Филтрирај по статус" value={statusFilter} onChange={e=>setStatusFilter(e.target.value as typeof statusFilter)}><option value="all">Сите активни</option><option>Чека залиха</option><option>Нова</option><option>Во подготовка</option></select>
   <button type="button" className="ghost" disabled={!list.length} onClick={toggleAll}>{allVisibleSelected?'Отштиклирај ги':'Штиклирај ги филтрираните'}</button>
   <button type="button" className="primary" disabled={!list.length} onClick={()=>onPrintReport(selected.length?selected:list,`${filterLabel} • ${selected.length?'Селектирани':'Сите филтрирани'}`)}><Printer size={18}/> Печати {selected.length?`селектирани (${selected.length})`:`филтрирани (${list.length})`}</button>
  </div>
  {selected.length>0&&<div className="selection-banner"><CheckCircle2 size={18}/><span>Избрани се <b>{selected.length}</b> од прикажаните нарачки.</span><button type="button" onClick={()=>setSelectedIds(new Set())}>Исчисти избор</button></div>}
  <Card>{list.length===0?<Empty text="Нема активни нарачки за овој филтер."/>:<div className="orders-list">{list.map(order=><article className={`${order.status==='Чека залиха'?'waiting-order ':''}${selectedIds.has(order.id)?'selected-order':''}`} key={order.id} onClick={()=>onOpen(order.id)}>
   <label className="order-select" aria-label={`Избери ${order.number}`} onClick={event=>event.stopPropagation()}><input type="checkbox" checked={selectedIds.has(order.id)} onChange={()=>toggle(order.id)}/><span/></label>
   <div className="order-main"><div className="order-number">{order.number}</div><h3>{order.client}</h3><p>{order.city} • {order.date}</p></div>
   <div className="order-qty"><span>{productName('p025')} <b>{order.qty025+order.free025} пак.</b>{(order.qty025Pieces||0)+(order.free025Pieces||0)>0&&` + ${(order.qty025Pieces||0)+(order.free025Pieces||0)} пар.`}</span><span>{productName('p15')} <b>{order.qty15+(order.free15||0)} пак.</b>{(order.qty15Pieces||0)+(order.free15Pieces||0)>0&&` + ${(order.qty15Pieces||0)+(order.free15Pieces||0)} пар.`}</span><span>Флаери <b>{order.flyers} пар.</b></span></div>
   <div className="order-actions"><span className={statusClass(order.status)}>{order.status}</span><button className="icon-btn" aria-label={`Измени ${order.number}`} onClick={event=>{event.stopPropagation();onEdit(order)}}><Pencil size={17}/></button>{onDelete&&<button className="icon-btn danger" aria-label={`Избриши ${order.number}`} onClick={event=>{event.stopPropagation();onDelete(order.id)}}><Trash2 size={17}/></button>}<ChevronRight size={20}/></div>
  </article>)}</div>}</Card>
 </>}

function Packing({order,orders,onSelect,patchPacked,changeStatus,advanceOrder,printOrder,onEdit,fromQr}:{order:Order|null;orders:Order[];onSelect:(id:string)=>void;patchPacked:(o:Order,key:keyof Order['packed'],value:boolean)=>void;changeStatus:(o:Order,s:OrderStatus)=>void;advanceOrder:(o:Order)=>void;printOrder:(o:Order)=>void;onEdit:(o:Order)=>void;fromQr:boolean}){
 if(!order)return <><PageHeader title="Пакување"/><Empty text="Нема нарачки за пакување."/></>
 const total025Packages=order.qty025+order.free025,total025Pieces=(order.qty025Pieces||0)+(order.free025Pieces||0),total15Packages=order.qty15+(order.free15||0),total15Pieces=(order.qty15Pieces||0)+(order.free15Pieces||0)
 const packageAmount=(packages:number,pieces:number)=>`${packages} пакети${pieces?` + ${pieces} парчиња`:''}`
 const groups=[['Чекаат залиха',orders.filter(o=>o.status==='Чека залиха')],['За пакување',orders.filter(o=>o.status==='Нова'||o.status==='Во подготовка')],['Спакувани',orders.filter(o=>o.status==='Спакувана')],['Излезени',orders.filter(o=>o.status==='Излезена')],['Испратени',orders.filter(o=>o.status==='Испратена')],['Доставени',orders.filter(o=>o.status==='Доставена')]] as const
 const statusOptions=[order.status,...allowedTransitions[order.status]],waitingForStock=order.status==='Чека залиха'
 const nextLabel:Partial<Record<OrderStatus,string>>={Нова:'Потврди цела нарачка → Спакувана','Во подготовка':'Потврди цела нарачка → Спакувана',Спакувана:'Следен статус → Испратена',Излезена:'Следен статус → Испратена',Испратена:'Следен статус → Доставена'}
 return <><PageHeader title="Пакување" action={<div className="packing-page-actions"><button className="ghost desktop-print-action" onClick={()=>printOrder(order)}><Printer size={18}/> Печати</button><PdfShareButton order={order} label="PDF / Печати" mobilePrint/></div>}/><div className="packing-layout">
  <Card className="order-selector"><h3>Патека на нарачки</h3>{groups.map(([label,list])=>list.length?<div className="order-group" key={label}><div className="order-group-label">{label}<b>{list.length}</b></div>{list.map(item=><button className={item.id===order.id?'selected':''} onClick={()=>onSelect(item.id)} key={item.id}><div><b>{item.client}</b><small>{item.number}</small></div><span className={statusClass(item.status)}>{item.status}</span></button>)}</div>:null)}</Card>
  <div className="packing-main"><Card className="packing-summary"><div><span>{order.number}</span><h2>{order.client}</h2><p>{order.city} • {order.date}</p></div><div className="packing-status-controls"><button className="ghost order-edit-action" onClick={()=>onEdit(order)}><Pencil size={17}/> Исправи</button><select aria-label="Статус на нарачка" value={order.status} onChange={e=>changeStatus(order,e.target.value as OrderStatus)}>{statusOptions.map(status=><option key={status}>{status}</option>)}</select></div></Card>
   {waitingForStock&&<div className="waiting-banner">Оваа нарачка чека залиха. Пакувањето ќе се отклучи автоматски кога ќе пристигне доволно стока.</div>}
   <Card className={`qr-order-panel${fromQr?' opened-from-qr':''}`}><div className="qr-order-copy"><QrCode/><div><span>{fromQr?'Отворено преку QR код':'QR код на спецификацијата'}</span><strong>Цела нарачка • еден QR код</strong><small>Провери ги производите подолу, па потврди го следниот статус.</small></div></div>{nextLabel[order.status]?<button className="primary qr-next-status" onClick={()=>advanceOrder(order)}>{nextLabel[order.status]} <ChevronRight size={18}/></button>:order.status==='Доставена'?<span className="workflow-complete"><CheckCircle2 size={17}/> Нарачката е доставена</span>:<span className="status">{order.status}</span>}</Card>
   <div className="pack-rows"><PackRowV2 checked={order.packed.regular025} disabled={order.stockDeducted||waitingForStock} onChange={value=>patchPacked(order,'regular025',value)} title={productName('p025')} qty={order.qty025} detail={breakdown(order.qty025,order.qty025Pieces||0)}/><PackRowV2 checked={order.packed.bib15} disabled={order.stockDeducted||waitingForStock} onChange={value=>patchPacked(order,'bib15',value)} title={productName('p15')} qty={order.qty15} detail={breakdown(order.qty15,order.qty15Pieces||0)}/><PackRowV2 checked={order.packed.free025} disabled={order.stockDeducted||waitingForStock} onChange={value=>patchPacked(order,'free025',value)} title={`Гратис ${productName('p025')}`} qty={order.free025} detail={`${breakdown(order.free025,order.free025Pieces||0)} • одделно`}/><PackRowV2 checked={Boolean(order.packed.free15)} disabled={order.stockDeducted||waitingForStock} onChange={value=>patchPacked(order,'free15',value)} title={`Гратис ${productName('p15')}`} qty={order.free15||0} detail={`${breakdown(order.free15||0,order.free15Pieces||0)} • одделно`}/><PackRowV2 checked={order.packed.flyers} disabled={order.stockDeducted||waitingForStock} onChange={value=>patchPacked(order,'flyers',value)} title="Флаери" qty={order.flyers} detail={`${order.flyers} парчиња`}/></div>
   <Card className="take-card"><div className="take-card-title"><WarehouseIcon/><span>Вкупно за земање од магацин</span></div><div className="take-list"><div><span>{productName('p025')}</span><strong>{packageAmount(total025Packages,total025Pieces)}</strong><small>редовни {order.qty025} пак. + гратис {order.free025} пак.</small></div><div><span>{productName('p15')}</span><strong>{packageAmount(total15Packages,total15Pieces)}</strong><small>редовни {order.qty15} пак. + гратис {order.free15||0} пак.</small></div><div><span>{productName('flyers')}</span><strong>{order.flyers} парчиња</strong><small>промотивен материјал</small></div></div></Card>
  </div>
 </div></>
}
const PackRowV2=({checked,disabled,onChange,title,qty,detail}:{checked:boolean;disabled:boolean;onChange:(value:boolean)=>void;title:string;qty:number;detail:string})=><label className={`pack-row ${checked?'done':''} ${disabled?'locked':''}`}><input type="checkbox" checked={checked} disabled={disabled} onChange={event=>onChange(event.target.checked)}/><div className="check-ui">{checked&&<CheckCircle2/>}</div><div><h3>{title}</h3><p>{detail}</p></div><strong>{qty}</strong></label>


function WarehousePage({state,receipts,receiptStatus,receiptError,onEntry,onReceipt,onEditReceipt}:{state:AppState;receipts:ReceiptRecord[];receiptStatus:ReceiptModuleStatus;receiptError:string;onEntry:()=>void;onReceipt:()=>void;onEditReceipt:(receipt:ReceiptRecord)=>void}){
 const today=todayLocal()
 const todayReceipts=receipts.filter(receipt=>receipt.receipt_date===today)
 const todayLines=todayReceipts.flatMap(receipt=>receipt.receipt_items)
 const today025=todayLines.filter(line=>line.product.code==='p025').reduce((sum,line)=>({packages:sum.packages+line.packages,pieces:sum.pieces+line.extra_pieces}),{packages:0,pieces:0})
 const today15=todayLines.filter(line=>line.product.code==='p15').reduce((sum,line)=>({packages:sum.packages+line.packages,pieces:sum.pieces+line.extra_pieces}),{packages:0,pieces:0})
 const todayFlyers=todayLines.filter(line=>line.product.code==='flyers').reduce((sum,line)=>sum+line.total_units,0)
 return <><PageHeader title="Магацин" action={<div className="page-actions"><button className="primary" disabled={receiptStatus!=='ready'} onClick={onReceipt}><CirclePlus size={18}/> Нова приемница</button><button className="ghost" onClick={onEntry}><ArrowLeftRight size={18}/> Друго движење</button></div>}/>
  {receiptStatus!=='ready'&&<div className={`receipt-module-alert ${receiptStatus==='missing'?'warning':'error'}`}><strong>{receiptStatus==='loading'?'Се вчитуваат приемниците…':'Приемниците не се активни'}</strong><span>{receiptError||'Провери ја врската со базата.'}</span>{receiptStatus==='missing'&&<code>supabase/phase1_receipts.sql</code>}</div>}
  <div className="stock-grid"><StockCard title={productName('p025')} packs={state.warehouse.p025.packages} pieces={state.warehouse.p025.pieces} total={state.warehouse.p025.total} reserved={reserved(state).p025} available={available(state).p025}/><StockCard title={productName('p15')} packs={state.warehouse.p15.packages} pieces={state.warehouse.p15.pieces} total={state.warehouse.p15.total} reserved={reserved(state).p15} available={available(state).p15}/><StockCard title={productName('flyers')} packs={0} pieces={state.warehouse.flyers} total={state.warehouse.flyers} reserved={reserved(state).flyers} available={available(state).flyers}/></div><Card className="receipt-summary"><div className="section-title"><div><h3>Денес примено</h3><p>{today} • етикетирано и спакувано од работниците</p></div><span className="receipt-count">{todayReceipts.length} приемници</span></div><div className="receipt-metrics"><ReceiptMetric label={productName('p025')} value={`${today025.packages} пак.${today025.pieces?` + ${today025.pieces} пар.`:''}`}/><ReceiptMetric label={productName('p15')} value={`${today15.packages} пак.${today15.pieces?` + ${today15.pieces} пар.`:''}`}/><ReceiptMetric label={productName('flyers')} value={`${todayFlyers} пар.`}/></div></Card><Card><div className="section-title"><div><h3>Приемници за роба</h3><p>Сите производи од една приемница се прикажани заедно</p></div></div><ReceiptTable receipts={receipts} onEdit={onEditReceipt}/></Card><Card><div className="section-title"><div><h3>Последни движења</h3><p>Излези, корекции и враќања</p></div></div><MovementTable movements={state.movements.slice(0,8)}/></Card></>
}
const ReceiptMetric=({label,value}:{label:string;value:string})=><div><span>{label}</span><strong>{value}</strong></div>
const receiptItems=(receipt:ReceiptRecord)=>receipt.receipt_items.map(line=>`${line.product.name}: ${line.packages} пак.${line.extra_pieces?` + ${line.extra_pieces} пар.`:''}`).join(' • ')
const ReceiptTable=({receipts,onView,onEdit}:{receipts:ReceiptRecord[];onView?:(receipt:ReceiptRecord)=>void;onEdit?:(receipt:ReceiptRecord)=>void})=>receipts.length===0?<Empty text="Сè уште нема внесени приемници."/>:<div className="table-wrap"><table className="receipt-table"><thead><tr><th>Приемница</th><th>Датум</th><th>Производи и количини</th><th>Работници / тим</th><th>Забелешка</th>{(onView||onEdit)&&<th>Акции</th>}</tr></thead><tbody>{receipts.map(receipt=><tr key={receipt.id}><td><b>{receipt.number}</b></td><td>{receipt.receipt_date}</td><td>{receiptItems(receipt)}</td><td>{receipt.workers_team||'—'}</td><td>{receipt.note||'—'}</td>{(onView||onEdit)&&<td><div className="archive-actions">{onView&&<button className="ghost compact-action" onClick={()=>onView(receipt)}><Eye size={16}/> Преглед</button>}{onEdit&&<button className="ghost compact-action" onClick={()=>onEdit(receipt)}><Pencil size={16}/> Измени</button>}</div></td>}</tr>)}</tbody></table></div>
function MovementsPage({state}:{state:AppState}){return <><PageHeader title="Историја на залиха"/><Card><MovementTable movements={state.movements}/></Card></>}
const MovementTable=({movements}:{movements:AppState['movements']})=>movements.length===0?<Empty text="Сè уште нема движења на залиха."/>:<div className="table-wrap"><table><thead><tr><th>Датум</th><th>Производ</th><th>Тип</th><th>Пакети</th><th>Парчиња</th><th>Клиент / тим</th><th>Документ / нарачка</th><th>Забелешка</th></tr></thead><tbody>{movements.map(m=><tr key={m.id}><td>{m.date}</td><td>{productName(m.product)}</td><td><span className="status">{m.type}</span></td><td>{m.packages}</td><td>{m.pieces}</td><td>{m.party||'—'}</td><td>{m.orderNumber||'—'}</td><td>{m.note||'—'}</td></tr>)}</tbody></table></div>
function PrintingPage({state,receipts,receiptStatus,receiptError,printOrder,printReceipt,onEditReceipt}:{state:AppState;receipts:ReceiptRecord[];receiptStatus:ReceiptModuleStatus;receiptError:string;printOrder:(o:Order)=>void;printReceipt:(receipt:ReceiptRecord)=>void;onEditReceipt:(receipt:ReceiptRecord)=>void}){
 const [selectedReceipt,setSelectedReceipt]=useState<ReceiptRecord|null>(null)
 const [selectedOrder,setSelectedOrder]=useState<Order|null>(null)
 const orders=[...state.orders].sort((a,b)=>b.number.localeCompare(a.number))
 const scrollTo=(id:string)=>document.getElementById(id)?.scrollIntoView({behavior:'smooth',block:'start'})
 return <><PageHeader title="Архива на документи"/><div className="archive-metrics"><button type="button" className="card archive-metric-link" onClick={()=>scrollTo('packing-archive')}><FileText/><span>Спецификации за пакување<strong>{orders.length}</strong><small>Отвори листа</small></span><ChevronRight/></button><button type="button" className="card archive-metric-link" onClick={()=>scrollTo('receipt-archive')}><ArchiveRestore/><span>Приемници за роба<strong>{receipts.length}</strong><small>Отвори листа</small></span><ChevronRight/></button></div><Card className="archive-card"><div id="packing-archive" className="archive-anchor"/><div className="section-title"><div><h3>Спецификации за пакување</h3><p>Преглед, печатење и споделување PDF на Viber</p></div></div>{orders.length===0?<Empty text="Нема спецификации за пакување."/>:<><div className="table-wrap archive-desktop"><table><thead><tr><th>Број</th><th>Датум на нарачка</th><th>Клиент</th><th>Град</th><th>Статус</th><th>Акции</th></tr></thead><tbody>{orders.map(order=><tr key={order.id}><td><b>{packingNumber(order)}</b></td><td>{order.date}</td><td>{order.client}</td><td>{order.city}</td><td><span className={statusClass(order.status)}>{order.status}</span></td><td><div className="archive-actions"><button className="ghost compact-action" onClick={()=>setSelectedOrder(order)}><Eye size={16}/> Преглед</button><button className="ghost compact-action" onClick={()=>printOrder(order)}><Printer size={16}/> Печати</button><PdfShareButton order={order} compact/></div></td></tr>)}</tbody></table></div><div className="archive-mobile-list">{orders.map(order=><article key={order.id}><div><span>{packingNumber(order)}</span><strong>{order.client}</strong><small>{order.city} • {order.date}</small></div><span className={statusClass(order.status)}>{order.status}</span><div className="archive-actions"><button className="ghost" onClick={()=>setSelectedOrder(order)}><Eye size={16}/> Преглед</button><button className="ghost" onClick={()=>printOrder(order)}><Printer size={16}/> Печати</button><PdfShareButton order={order}/></div></article>)}</div></>}</Card><Card className="archive-card"><div id="receipt-archive" className="archive-anchor"/><div className="section-title"><div><h3>Приемници за роба</h3><p>Целосна архива на примена и изработена роба</p></div></div>{receiptStatus!=='ready'&&<div className={`receipt-module-alert ${receiptStatus==='missing'?'warning':'error'}`}><span>{receiptError||'Приемниците се вчитуваат…'}</span>{receiptStatus==='missing'&&<code>supabase/phase1_receipts.sql</code>}</div>}<div className="archive-desktop"><ReceiptTable receipts={receipts} onView={setSelectedReceipt} onEdit={onEditReceipt}/></div><div className="archive-mobile-list">{receipts.map(receipt=><article key={receipt.id}><div><span>{receipt.number}</span><strong>{receipt.workers_team||'Почетна состојба'}</strong><small>{receipt.receipt_date} • {receiptItems(receipt)}</small></div><div className="archive-actions"><button className="ghost" onClick={()=>setSelectedReceipt(receipt)}><Eye size={16}/> Преглед</button><button className="ghost" onClick={()=>onEditReceipt(receipt)}><Pencil size={16}/> Измени</button></div></article>)}</div></Card>{selectedOrder&&<OrderDetails order={selectedOrder} onClose={()=>setSelectedOrder(null)} onPrint={()=>printOrder(selectedOrder)}/>} {selectedReceipt&&<ReceiptDetails receipt={selectedReceipt} onClose={()=>setSelectedReceipt(null)} onPrint={()=>printReceipt(selectedReceipt)} onEdit={()=>{setSelectedReceipt(null);onEditReceipt(selectedReceipt)}}/>}</>
}
function PdfShareButton({order,compact=false,label='PDF / Viber',mobilePrint=false}:{order:Order;compact?:boolean;label?:string;mobilePrint?:boolean}){const [busy,setBusy]=useState(false);return <button type="button" className={`viber-action${compact?' compact-action':''}${mobilePrint?' packing-mobile-print':''}`} disabled={busy} onClick={async()=>{setBusy(true);try{const result=await shareOrderPdf(order);if(result==='downloaded')alert('PDF-от е симнат. Отвори го за печатење или прикачи го во Viber.')}catch(error){if(error instanceof DOMException&&error.name==='AbortError')return;alert(error instanceof Error?error.message:'Не може да се создаде PDF.')}finally{setBusy(false)}}}>{mobilePrint?<Printer size={16}/>:<Send size={16}/>} {busy?'Се подготвува...':label}</button>}
function OrderDetails({order,onClose,onPrint}:{order:Order;onClose:()=>void;onPrint:()=>void}){const rows=[[productName('p025'),order.qty025,order.qty025Pieces||0],[productName('p15'),order.qty15,order.qty15Pieces||0],[`Гратис ${productName('p025')}`,order.free025,order.free025Pieces||0],[`Гратис ${productName('p15')}`,order.free15||0,order.free15Pieces||0],[productName('flyers'),0,order.flyers]] as const;return <Modal title={`Нарачка ${order.number}`} onClose={onClose}><div className="receipt-detail order-detail"><div className="receipt-detail-meta"><span>Клиент <b>{order.client}</b></span><span>Град <b>{order.city}</b></span><span>Датум <b>{order.date}</b></span><span>Статус <b>{order.status}</b></span></div><div className="table-wrap"><table><thead><tr><th>Производ</th><th>Пакети</th><th>Парчиња</th></tr></thead><tbody>{rows.map(([name,packages,pieces])=><tr key={name}><td>{name}</td><td>{packages}</td><td>{pieces}</td></tr>)}</tbody></table></div><p className="receipt-detail-note"><b>Забелешка:</b> {order.note||'—'}</p><div className="modal-actions"><button className="ghost" onClick={onClose}>Затвори</button><button className="ghost" onClick={onPrint}><Printer size={17}/> Печати</button><PdfShareButton order={order}/></div></div></Modal>}
function ReceiptDetails({receipt,onClose,onPrint,onEdit}:{receipt:ReceiptRecord;onClose:()=>void;onPrint:()=>void;onEdit?:()=>void}){return <Modal title={`Приемница ${receipt.number}`} onClose={onClose}><div className="receipt-detail"><div className="receipt-detail-meta"><span>Датум <b>{receipt.receipt_date}</b></span><span>Работници / тим <b>{receipt.workers_team||'—'}</b></span></div><div className="table-wrap"><table><thead><tr><th>Производ</th><th>Пакети</th><th>Доп. парчиња</th><th>Вкупно</th></tr></thead><tbody>{receipt.receipt_items.map(line=><tr key={line.id}><td>{line.product.name}</td><td>{line.packages}</td><td>{line.extra_pieces}</td><td>{line.total_units}</td></tr>)}</tbody></table></div><p className="receipt-detail-note"><b>Забелешка:</b> {receipt.note||'—'}</p><div className="modal-actions"><button className="ghost" onClick={onClose}>Затвори</button>{onEdit&&<button className="ghost" onClick={onEdit}><Pencil size={17}/> Измени</button>}<button className="primary" onClick={onPrint}><Printer size={17}/> Печати приемница</button></div></div></Modal>}
function SettingsPage({onReset,syncStatus,syncError,email,role,isAdmin,openAdmin,thresholds,onThresholds}:{onReset?:()=>void;syncStatus:SyncStatus;syncError:string;email:string;role:'admin'|'operator';isAdmin:boolean;openAdmin:()=>void;thresholds:StockThresholds;onThresholds?:(value:StockThresholds)=>void}){const labels:Record<SyncStatus,string>={loading:'Се вчитува...',offline:'Не е поврзано',syncing:'Се зачувува...',synced:'Синхронизирано',error:'Грешка во синхронизација'};const threshold=(key:keyof StockThresholds,value:string)=>onThresholds?.({...thresholds,[key]:Math.max(0,Number(value)||0)});return <><PageHeader title="Поставки"/><Card className="settings-card">{syncStatus==='error'?<CloudOff/>:<Cloud/>}<div><h3>Онлајн синхронизација</h3><p><b>{labels[syncStatus]}</b> • {email}{syncError&&<><br/><small>{syncError}</small></>}</p></div><button className="ghost" onClick={()=>void supabase.auth.signOut()}><LogOut size={18}/> Одјави се</button></Card><Card className="settings-card"><ShieldCheck/><div><h3>Кориснички профил</h3><p>Улога: <b>{role==='admin'?'Администратор':'Оператор'}</b>{isAdmin?' • Имаш целосни права.':' • Работиш во заедничкиот магацин.'}</p></div>{isAdmin&&<button className="ghost" onClick={openAdmin}>Отвори администрација</button>}</Card><Card className="settings-card threshold-settings"><WarehouseIcon/><div><h3>Минимални прагови на залиха</h3><p>Кога залихата ќе падне до прагот, контролната табла се обојува жолто и нуди Viber известување.</p><div className="threshold-grid"><Field label={productName('p025')}><input type="number" min="0" disabled={!onThresholds} value={thresholds.p025} onChange={e=>threshold('p025',e.target.value)}/></Field><Field label={productName('p15')}><input type="number" min="0" disabled={!onThresholds} value={thresholds.p15} onChange={e=>threshold('p15',e.target.value)}/></Field><Field label="Флаери"><input type="number" min="0" disabled={!onThresholds} value={thresholds.flyers} onChange={e=>threshold('flyers',e.target.value)}/></Field></div></div></Card>{onReset&&<Card className="settings-card"><ArchiveRestore/><div><h3>Демо податоци</h3><p>Врати ја почетната залиха, клиентите и осумте демо нарачки.</p></div><button className="danger-btn" onClick={onReset}><RotateCcw size={18}/> Ресетирај демо податоци</button></Card>}<Card className="settings-card"><Truck/><div><h3>Автоматско ажурирање</h3><p>Апликацијата сама ја презема најновата верзија на истиот линк. Тековна верзија: <b>{appVersion}</b></p></div></Card></>}

type OrderFormValues={client:string;city:string;p025:string;e025:string;p15:string;e15:string;free025:string;free025Pieces:string;free15:string;free15Pieces:string;flyers:string;note:string}
const orderFormValues=(order?:Order|null):OrderFormValues=>({client:order?.client||'',city:order?.city||'',p025:String(order?.qty025||0),e025:String(order?.qty025Pieces||0),p15:String(order?.qty15||0),e15:String(order?.qty15Pieces||0),free025:String(order?.free025||0),free025Pieces:String(order?.free025Pieces||0),free15:String(order?.free15||0),free15Pieces:String(order?.free15Pieces||0),flyers:String(order?.flyers||0),note:order?.note||''})
type OrderItemKey='p025'|'p15'|'free025'|'free15'|'flyers'
type NumericOrderField='p025'|'e025'|'p15'|'e15'|'free025'|'free025Pieces'|'free15'|'free15Pieces'|'flyers'
const orderItemKeys:OrderItemKey[]=['p025','p15','free025','free15','flyers']
const orderItemConfig:Record<OrderItemKey,{label:string;packages?:NumericOrderField;pieces:NumericOrderField;maxPieces?:number}>={
 p025:{label:productName('p025'),packages:'p025',pieces:'e025',maxPieces:14},
 p15:{label:productName('p15'),packages:'p15',pieces:'e15',maxPieces:5},
 free025:{label:`Гратис ${productName('p025')}`,packages:'free025',pieces:'free025Pieces',maxPieces:14},
 free15:{label:`Гратис ${productName('p15')}`,packages:'free15',pieces:'free15Pieces',maxPieces:5},
 flyers:{label:productName('flyers'),pieces:'flyers'},
}
const visibleOrderItems=(values:OrderFormValues,initial?:Order):OrderItemKey[]=>{
 if(!initial)return ['p025'] as OrderItemKey[]
 const visible=orderItemKeys.filter(key=>{const config=orderItemConfig[key];return Number(values[config.pieces])>0||Boolean(config.packages&&Number(values[config.packages])>0)})
 return visible.length?visible:['p025']
}

function NewOrder({state,onClose,onSave}:{state:AppState;onClose:()=>void;onSave:(o:Order)=>void}){return <OrderEditor state={state} onClose={onClose} onSave={onSave}/>}
function EditOrder({state,order,onClose,onSave}:{state:AppState;order:Order;onClose:()=>void;onSave:(o:Order)=>void}){return <OrderEditor state={state} initial={order} onClose={onClose} onSave={onSave}/>}

function OrderEditor({state,initial,onClose,onSave}:{state:AppState;initial?:Order;onClose:()=>void;onSave:(o:Order)=>void}){
 const initialClient=state.clients.find(client=>client.name.trim().toLowerCase()===initial?.client.trim().toLowerCase())
 const [clientId,setClientId]=useState(initialClient?.id||'')
 const [f,setF]=useState<OrderFormValues>(()=>orderFormValues(initial))
 const [items,setItems]=useState<OrderItemKey[]>(()=>visibleOrderItems(orderFormValues(initial),initial))
 const [itemToAdd,setItemToAdd]=useState<OrderItemKey>('p025')
 const draft:Order={id:initial?.id||'draft',number:initial?.number||makeOrderNumber(state.orders),client:f.client.trim(),city:f.city.trim(),date:initial?.date||todayLocal(),qty025:+f.p025,qty025Pieces:+f.e025,qty15:+f.p15,qty15Pieces:+f.e15,free025:+f.free025,free025Pieces:+f.free025Pieces,free15:+f.free15,free15Pieces:+f.free15Pieces,flyers:+f.flyers,note:f.note.trim(),status:initial?.status||'Нова',packed:initial?.packed||{regular025:false,bib15:false,free025:false,free15:false,flyers:false},stockDeducted:Boolean(initial?.stockDeducted)}
 const capacityState=initial?{...state,orders:state.orders.filter(order=>order.id!==initial.id)}:state
 const shortage=reservationShortage(capacityState,draft)
 const hasItems=draft.qty025+(draft.qty025Pieces||0)+draft.qty15+(draft.qty15Pieces||0)+draft.free025+(draft.free025Pieces||0)+(draft.free15||0)+(draft.free15Pieces||0)+draft.flyers>0
 const stockValid=canReserveOrder(capacityState,draft)
 const valid=hasItems
 const chooseClient=(id:string)=>{setClientId(id);const client=state.clients.find(item=>item.id===id);if(client)setF(current=>({...current,client:client.name,city:client.city}));else if(id==='new')setF(current=>({...current,client:'',city:''}))}
 const availableItems=orderItemKeys.filter(key=>!items.includes(key))
 const addItem=()=>{const key=availableItems.includes(itemToAdd)?itemToAdd:availableItems[0];if(!key)return;setItems(current=>[...current,key]);setItemToAdd(availableItems.find(item=>item!==key)||'p025')}
 const removeItem=(key:OrderItemKey)=>{const config=orderItemConfig[key];setF(current=>({...current,[config.pieces]:'0',...(config.packages?{[config.packages]:'0'}:{})}));setItems(current=>current.filter(item=>item!==key))}
 return <Modal title={initial?`Исправка на ${initial.number}`:'Нова нарачка'} onClose={onClose}><form onSubmit={event=>{event.preventDefault();if(valid)onSave({...draft,id:initial?.id||crypto.randomUUID()})}} className="form-grid order-form">
  <div className="form-section-title"><span>1</span><div><strong>Клиент</strong><small>Избери постоен клиент за автоматски да се пополни градот.</small></div></div>
  <Field label="Постоен клиент"><select value={clientId} onChange={event=>chooseClient(event.target.value)}><option value="">Избери клиент...</option>{state.clients.map(client=><option key={client.id} value={client.id}>{client.name} - {client.city}</option>)}<option value="new">+ Нов клиент</option></select></Field>
  <div/>
  <Field label="Клиент"><input required value={f.client} onChange={event=>setF({...f,client:event.target.value})}/></Field>
  <Field label="Град"><input required value={f.city} onChange={event=>setF({...f,city:event.target.value})}/></Field>
  <div className="form-section-title"><span>2</span><div><strong>Ставки</strong><small>Додај ги само производите што се дел од нарачката.</small></div></div>
  <div className="line-items-editor">
   {items.map(key=>{const config=orderItemConfig[key];return <div className="line-item-row" key={key}><div className="line-item-name"><Package size={18}/><strong>{config.label}</strong></div>{config.packages&&<Field label="Пакети"><input min="0" type="number" inputMode="numeric" value={f[config.packages]} onChange={event=>setF(current=>({...current,[config.packages!]:event.target.value}))}/></Field>}<Field label={config.packages?'Доп. парчиња':'Парчиња'}><input min="0" max={config.maxPieces} type="number" inputMode="numeric" value={f[config.pieces]} onChange={event=>setF(current=>({...current,[config.pieces]:event.target.value}))}/></Field><button type="button" className="icon-btn danger line-item-remove" aria-label={`Отстрани ${config.label}`} onClick={()=>removeItem(key)}><Trash2 size={17}/></button></div>})}
   {availableItems.length>0&&<div className="add-line-item"><select aria-label="Нова ставка" value={availableItems.includes(itemToAdd)?itemToAdd:availableItems[0]} onChange={event=>setItemToAdd(event.target.value as OrderItemKey)}>{availableItems.map(key=><option key={key} value={key}>{orderItemConfig[key].label}</option>)}</select><button type="button" className="ghost" onClick={addItem}><CirclePlus size={17}/> Додај ставка</button></div>}
  </div>
  <Field label="Забелешка"><textarea value={f.note} onChange={event=>setF({...f,note:event.target.value})}/></Field>
  <div className="calc-banner"><b>Вкупно:</b> {productName('p025')} {Number(f.p025)+Number(f.free025)} пак. + {Number(f.e025)+Number(f.free025Pieces)} пар. • {productName('p15')} {Number(f.p15)+Number(f.free15)} пак. + {Number(f.e15)+Number(f.free15Pieces)} пар. • Флаери {Number(f.flyers)} пар.</div>
  {!hasItems?<div className="stock-validation error"><CloudOff size={18}/> Внеси барем еден производ.</div>:stockValid?<div className="stock-validation ok"><CheckCircle2 size={18}/>Количината е достапна и ќе биде резервирана.</div>:<div className="stock-validation warning"><CloudOff size={18}/><span>Нарачката ќе се зачува со статус „Чека залиха“ и ќе биде на врвот на листата.{shortage.p025>0&&` ${productName('p025')}: недостигаат ${shortage.p025}.`}{shortage.p15>0&&` ${productName('p15')}: недостигаат ${shortage.p15}.`}{shortage.flyers>0&&` Флаери: недостигаат ${shortage.flyers}.`}</span></div>}
  <div className="modal-actions"><button type="button" className="ghost" onClick={onClose}>Откажи</button><button className="primary" disabled={!valid}>{initial?'Зачувај исправка':'Зачувај нарачка'}</button></div>
 </form></Modal>
}
function StockEntry({onClose,onSave}:{onClose:()=>void;onSave:(p:ProductKey,t:MovementType,pack:number,pieces:number,party:string,note:string,date:string)=>void}){const [f,setF]=useState({product:'p025' as ProductKey,type:'Корекција' as MovementType,packages:'0',pieces:'0',party:'',note:'',doc:'',date:new Date().toISOString().slice(0,10)});return <Modal title="Друго движење на залиха" onClose={onClose}><form className="form-grid" onSubmit={e=>{e.preventDefault();onSave(f.product,f.type,+f.packages,+f.pieces,f.party,`${f.doc?`Документ: ${f.doc}. `:''}${f.note}`,f.date)}}><Field label="Производ"><select value={f.product} onChange={e=>setF({...f,product:e.target.value as ProductKey})}><option value="p025">{productName('p025')}</option><option value="p15">{productName('p15')}</option><option value="flyers">Флаери</option></select></Field><Field label="Тип"><select value={f.type} onChange={e=>setF({...f,type:e.target.value as MovementType})}>{['Излез','Корекција','Враќање','Оштетување'].map(x=><option key={x}>{x}</option>)}</select></Field><Field label="Пакети"><input type="number" min="0" value={f.packages} disabled={f.product==='flyers'} onChange={e=>setF({...f,packages:e.target.value})}/></Field><Field label="Индивидуални парчиња"><input type="number" min="0" value={f.pieces} onChange={e=>setF({...f,pieces:e.target.value})}/></Field><Field label="Добавувач / клиент"><input value={f.party} onChange={e=>setF({...f,party:e.target.value})}/></Field><Field label="Документ / фактура"><input value={f.doc} onChange={e=>setF({...f,doc:e.target.value})}/></Field><Field label="Датум"><input type="date" value={f.date} onChange={e=>setF({...f,date:e.target.value})}/></Field><Field label="Забелешка"><textarea value={f.note} onChange={e=>setF({...f,note:e.target.value})}/></Field><div className="modal-actions"><button type="button" className="ghost" onClick={onClose}>Откажи</button><button className="primary">Зачувај движење</button></div></form></Modal>}
const newReceiptLine=(productId:string):ReceiptItemDraft=>({id:crypto.randomUUID(),productId,packages:0,extraPieces:0})
function ReceiptEntry({products,initial,onClose,onSave}:{products:ProductRecord[];initial:ReceiptRecord|null;onClose:()=>void;onSave:(input:ReceiptInput)=>Promise<void>}){
 const initialItems=()=>initial?.receipt_items.map(line=>({id:line.id,productId:line.product_id,packages:line.packages,extraPieces:line.extra_pieces}))||[newReceiptLine(products[0]?.id||'')]
 const [lines,setLines]=useState<ReceiptItemDraft[]>(initialItems)
 const [workers,setWorkers]=useState(initial?.workers_team||'')
 const [note,setNote]=useState(initial?.note||'')
 const [date,setDate]=useState(initial?.receipt_date||todayLocal())
 const [message,setMessage]=useState('')
 const [busy,setBusy]=useState(false)
 const used=new Set(lines.map(line=>line.productId))
 const available=products.filter(product=>product.active&&!used.has(product.id))
 const updateLine=(id:string,patch:Partial<ReceiptItemDraft>)=>setLines(current=>current.map(line=>line.id===id?{...line,...patch}:line))
 const addLine=()=>{const product=available[0];if(product)setLines(current=>[...current,newReceiptLine(product.id)])}
 const submit=async(event:FormEvent)=>{
  event.preventDefault();setMessage('')
  try{
   const items=validateReceiptItems(lines,products)
   setBusy(true)
   await onSave({receiptDate:date,workersTeam:workers.trim(),note:note.trim(),items})
  }catch(error){setMessage(error instanceof ReceiptValidationError||error instanceof Error?error.message:'Приемницата не може да се зачува.')}finally{setBusy(false)}
 }
 const positiveLines=lines.filter(line=>{const product=products.find(item=>item.id===line.productId);return product&&receiptItemUnits(line,product.package_size)>0}).length
 return <Modal title={initial?`Измена на приемница ${initial.number}`:'Нова приемница за роба'} onClose={onClose}><form className="form-grid receipt-entry-form" onSubmit={submit}>
  <div className="receipt-number-banner"><span>Број на приемница</span><strong>{initial?.number||'Автоматски при зачувување'}</strong></div>
  <Field label="Датум на прием"><input type="date" required value={date} onChange={event=>setDate(event.target.value)}/></Field>
  <Field label="Работници / тим"><input required placeholder="Имиња или смена" value={workers} onChange={event=>setWorkers(event.target.value)}/></Field>
  <div className="form-section-title"><span>1</span><div><strong>Примени ставки</strong><small>Сите ставки ќе бидат зачувани атомски под една приемница.</small></div></div>
  <div className="line-items-editor">
   {lines.map(line=>{const product=products.find(item=>item.id===line.productId);const options=products.filter(item=>item.active&&(item.id===line.productId||!used.has(item.id)));return <div className="line-item-row" key={line.id}><Field label="Производ"><select required value={line.productId} onChange={event=>updateLine(line.id,{productId:event.target.value,packages:0,extraPieces:0})}><option value="" disabled>Избери производ</option>{options.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Пакети"><input type="number" min="0" step="1" inputMode="numeric" value={line.packages} onChange={event=>updateLine(line.id,{packages:Math.max(0,Number(event.target.value)||0)})}/></Field><Field label={product?.package_size===1?'Парчиња':'Доп. парчиња'}><input type="number" min="0" max={product&&product.package_size>1?product.package_size-1:undefined} step="1" inputMode="numeric" value={line.extraPieces} onChange={event=>updateLine(line.id,{extraPieces:Math.max(0,Number(event.target.value)||0)})}/></Field><button type="button" className="icon-btn danger line-item-remove" aria-label={`Избриши ${product?.name||'ставка'}`} onClick={()=>setLines(current=>current.filter(item=>item.id!==line.id))}><Trash2 size={17}/></button></div>})}
   {available.length>0&&<button type="button" className="ghost add-receipt-line" onClick={addLine}><CirclePlus size={17}/> + Додади ставка</button>}
   {lines.length===0&&products.length>0&&<button type="button" className="ghost add-receipt-line" onClick={()=>setLines([newReceiptLine(products[0].id)])}><CirclePlus size={17}/> + Додади ставка</button>}
  </div>
  <Field label="Забелешка"><textarea placeholder="Етикетирање, пакување или друга забелешка" value={note} onChange={event=>setNote(event.target.value)}/></Field>
  <div className="calc-banner"><b>{positiveLines} ставки со количина.</b> {initial?'Во магацин ќе се примени само разликата од старата количина.':'Со зачувување, сите количини се додаваат во магацинот.'}</div>
  {message&&<div className="stock-validation error"><CloudOff size={18}/>{message}</div>}
  <div className="modal-actions"><button type="button" className="ghost" onClick={onClose}>Откажи</button><button className="primary" disabled={busy||products.length===0||positiveLines===0}>{busy?'Се зачувува…':initial?'Зачувај измена':'Зачувај приемница'}</button></div>
 </form></Modal>
}
function ReceiptPrint({receipt}:{receipt:ReceiptRecord}){return <div className="print-sheet"><header className="packing-print-head"><h1>ПРИЕМНИЦА ЗА РОБА</h1></header><section className="packing-print-meta"><div><span>Број на приемница</span><strong>{receipt.number}</strong></div><div className="packing-client"><span>Работници / тим</span><strong>{receipt.workers_team||'—'}</strong></div><div><span>Датум</span><b>{formatDocumentDate(receipt.receipt_date)}</b></div><div><span>Тип</span><b>Прием на готова роба</b></div></section><table className="packing-print-table"><thead><tr><th>Производ</th><th>Пакети</th><th>Доп. парчиња</th><th>Вкупно единици</th></tr></thead><tbody>{receipt.receipt_items.map(line=><tr key={line.id}><td><strong>{line.product.name}</strong></td><td>{line.packages}</td><td>{line.extra_pieces}</td><td><strong>{line.total_units}</strong></td></tr>)}</tbody></table><section className="packing-notes"><span>Забелешка</span><p>{receipt.note||'________________________________________________________________'}</p></section><div className="packing-sign"><span>Предал / примил</span><i/></div></div>}
function OrderReportPrint({orders,filterLabel}:{orders:Order[];filterLabel:string}){
 const totals=orderReportTotals(orders)
 const quantity=(packages:number,pieces:number)=>`${packages} пак.${pieces?` + ${pieces} пар.`:''}`
 return <div className="print-sheet order-report-print"><header className="packing-print-head"><h1>ИЗВЕШТАЈ ЗА НАРАЧКИ</h1></header>
  <section className="report-print-meta"><div><span>Датум на извештај</span><strong>{formatDocumentDate(todayLocal())}</strong></div><div><span>Број на нарачки</span><strong>{orders.length}</strong></div><p>{filterLabel}</p></section>
  <section className="report-total-grid"><div><span>{productName('p025')}</span><strong>{quantity(totals.p025Packages,totals.p025Pieces)}</strong></div><div><span>{productName('p15')}</span><strong>{quantity(totals.p15Packages,totals.p15Pieces)}</strong></div><div><span>{productName('flyers')}</span><strong>{totals.flyers} пар.</strong></div></section>
  <table className="packing-print-table"><thead><tr><th>Број</th><th>Клиент</th><th>Статус</th><th>{productName('p025')}</th><th>{productName('p15')}</th><th>Флаери</th></tr></thead><tbody>{orders.map(order=><tr key={order.id}><td><strong>{order.number}</strong></td><td>{order.client}<small>{order.city}</small></td><td>{order.status}</td><td>{quantity(order.qty025+order.free025,(order.qty025Pieces||0)+(order.free025Pieces||0))}</td><td>{quantity(order.qty15+(order.free15||0),(order.qty15Pieces||0)+(order.free15Pieces||0))}</td><td>{order.flyers} пар.</td></tr>)}</tbody></table>
 </div>
}
function PackingPrint({o,qrDataUrl}:{o:Order;qrDataUrl:string}){
 const format=(value:number)=>String(value).replace(/\B(?=(\d{3})+(?!\d))/g,'.')
 const packageQuantity=(packages:number,pieces:number)=>`${packages} пакети${pieces?` + ${pieces} парчиња`:''}`
 const regular025Pieces=o.qty025*15+(o.qty025Pieces||0)
 const bib15Pieces=o.qty15*6+(o.qty15Pieces||0)
 const free025Pieces=o.free025*15+(o.free025Pieces||0)
 const free15Pieces=(o.free15||0)*6+(o.free15Pieces||0)
 const packingResult=(packages:number,extraPieces:number,perPackage:number,total:number,unit:string)=>`${packages} × ${perPackage}${extraPieces?` + ${extraPieces}`:''} = ${format(total)} ${unit}`
 return <div className="print-sheet">
  <header className="packing-print-head"><h1>СПЕЦИФИКАЦИЈА ЗА ПАКУВАЊЕ</h1>{qrDataUrl&&<img className="packing-order-qr" src={qrDataUrl} alt="QR код за нарачката"/>}</header>
  <section className="packing-print-meta"><div><span>Број на спецификација</span><strong>{packingNumber(o)}</strong></div><div className="packing-client"><span>Клиент</span><strong>{o.client}</strong></div><div><span>Датум</span><b>{formatDocumentDate(o.date)}</b></div><div><span>Град</span><b>{o.city}</b></div></section>
  <table className="packing-print-table"><thead><tr><th>Производ</th><th>Количина</th><th>Бр. во пакет</th><th>Пакување</th></tr></thead><tbody>
   <tr><td><strong>{productName('p025')}</strong></td><td>{packageQuantity(o.qty025,o.qty025Pieces||0)}</td><td>15 шишиња</td><td><strong>{packingResult(o.qty025,o.qty025Pieces||0,15,regular025Pieces,'шишиња')}</strong></td></tr>
   <tr><td><strong>{productName('p15')}</strong></td><td>{packageQuantity(o.qty15,o.qty15Pieces||0)}</td><td>6 БиБ</td><td><strong>{packingResult(o.qty15,o.qty15Pieces||0,6,bib15Pieces,'БиБ')}</strong></td></tr>
   <tr><td><strong>Гратис {productName('p025')}</strong><small>Се пакува одделно</small></td><td>{packageQuantity(o.free025,o.free025Pieces||0)}</td><td>15 шишиња</td><td><strong>{packingResult(o.free025,o.free025Pieces||0,15,free025Pieces,'шишиња')}</strong><small>ОДДЕЛНО</small></td></tr>
   <tr><td><strong>Гратис {productName('p15')}</strong><small>Се пакува одделно</small></td><td>{packageQuantity(o.free15||0,o.free15Pieces||0)}</td><td>6 БиБ</td><td><strong>{packingResult(o.free15||0,o.free15Pieces||0,6,free15Pieces,'БиБ')}</strong><small>ОДДЕЛНО</small></td></tr>
   <tr><td><strong>{productName('flyers')}</strong></td><td>{format(o.flyers)} парчиња</td><td>—</td><td><strong>{format(o.flyers)} парчиња</strong></td></tr>
  </tbody></table>
  <section className="packing-notes"><span>Забелешка</span><p>{o.note||'________________________________________________________________'}</p></section>
  <div className="packing-sign"><span>Спакувал</span><i/></div>
 </div>
}
export default App

import { useMemo, useState } from 'react'
import { ChevronRight, MapPin, PackageCheck, ShoppingBag, Truck } from 'lucide-react'
import type { AppState, Client, Order, OrderStatus } from '../types'
import { productName } from '../lib/logic'
import { Empty, Modal, PageHeader } from './UI'

const takenStatuses = new Set<OrderStatus>(['Спакувана','Излезена','Испратена','Доставена'])
const normalizeName = (name:string) => name.trim().toLocaleLowerCase('mk')
const statusClass = (status:OrderStatus) => `status ${status.replaceAll(' ','-').toLowerCase()}`
const formatPackages = (packages:number,pieces:number) => `${packages} пак.${pieces?` + ${pieces} пар.`:''}`

type ProductTotals = {
  p025Packages:number
  p025Pieces:number
  p15Packages:number
  p15Pieces:number
  flyers:number
}

type ClientSummary = {
  client:Client
  orders:Order[]
  taken:Order[]
  orderedTotals:ProductTotals
  takenTotals:ProductTotals
  lastOrder?:Order
}

const emptyTotals=():ProductTotals=>({p025Packages:0,p025Pieces:0,p15Packages:0,p15Pieces:0,flyers:0})

function addOrder(totals:ProductTotals,order:Order){
  totals.p025Packages+=order.qty025+order.free025
  totals.p025Pieces+=(order.qty025Pieces||0)+(order.free025Pieces||0)
  totals.p15Packages+=order.qty15+(order.free15||0)
  totals.p15Pieces+=(order.qty15Pieces||0)+(order.free15Pieces||0)
  totals.flyers+=order.flyers
}

function buildSummaries(state:AppState):ClientSummary[]{
  const ordersByClient=new Map<string,Order[]>()
  for(const order of state.orders){
    const key=normalizeName(order.client)
    const existing=ordersByClient.get(key)
    if(existing)existing.push(order)
    else ordersByClient.set(key,[order])
  }
  return state.clients.map(client=>{
    const orders=(ordersByClient.get(normalizeName(client.name))||[]).toSorted((a,b)=>b.date.localeCompare(a.date)||b.number.localeCompare(a.number))
    const validOrders=orders.filter(order=>order.status!=='Откажана')
    const taken=validOrders.filter(order=>order.stockDeducted||takenStatuses.has(order.status))
    const orderedTotals=emptyTotals()
    const takenTotals=emptyTotals()
    for(const order of validOrders)addOrder(orderedTotals,order)
    for(const order of taken)addOrder(takenTotals,order)
    return {client,orders,taken,orderedTotals,takenTotals,lastOrder:orders[0]}
  }).toSorted((a,b)=>(b.lastOrder?.date||'').localeCompare(a.lastOrder?.date||'')||a.client.name.localeCompare(b.client.name,'mk'))
}

export function ClientsPage({state}:{state:AppState}){
  const summaries=useMemo(()=>buildSummaries(state),[state])
  const [selectedId,setSelectedId]=useState<string|null>(null)
  const selected=summaries.find(summary=>summary.client.id===selectedId)||null
  return <><PageHeader title="Клиенти"/><div className="client-grid">{summaries.map(summary=><ClientCard key={summary.client.id} summary={summary} onOpen={()=>setSelectedId(summary.client.id)}/>)}</div>{selected&&<ClientDetails summary={selected} onClose={()=>setSelectedId(null)}/>}</>
}

function ClientCard({summary,onOpen}:{summary:ClientSummary;onOpen:()=>void}){
  const {client,orders,taken,orderedTotals,lastOrder}=summary
  return <button type="button" className="card client-card client-card-button" onClick={onOpen}><div className="client-card-head"><div className="avatar">{client.name.slice(0,2).toUpperCase()}</div><ChevronRight/></div><h3>{client.name}</h3><p><MapPin size={14}/>{client.city}</p><div className="client-card-stats"><span>Нарачки <b>{orders.length}</b></span><span>Земени <b>{taken.length}</b></span><span>Последна <b>{lastOrder?.date||'—'}</b></span></div><div className="client-product-preview"><span>{productName('p025')} <b>{orderedTotals.p025Packages} пак.</b></span><span>{productName('p15')} <b>{orderedTotals.p15Packages} пак.</b></span><span>Флаери <b>{orderedTotals.flyers}</b></span></div><small>{client.phone||'Нема внесен телефон'} • {client.contactPerson||'Нема контакт лице'}</small></button>
}

function ClientDetails({summary,onClose}:{summary:ClientSummary;onClose:()=>void}){
  const {client,orders,taken,orderedTotals,takenTotals,lastOrder}=summary
  return <Modal title={client.name} onClose={onClose}><div className="client-detail"><div className="client-detail-contact"><span><MapPin size={16}/>{client.city}{client.address?` • ${client.address}`:''}</span><span>{client.contactPerson||'Нема контакт лице'} • {client.phone||'Нема телефон'}</span></div><div className="client-detail-metrics"><div><ShoppingBag/><span>Вкупно нарачки<strong>{orders.length}</strong></span></div><div><PackageCheck/><span>Земени од магацин<strong>{taken.length}</strong></span></div><div><Truck/><span>Последна нарачка<strong>{lastOrder?.date||'—'}</strong></span></div></div><section className="client-consumption"><div className="section-title"><div><h3>Потрошувачка по производ</h3><p>Основа за идна анализа на продажба и планирање залиха</p></div></div><div className="client-consumption-table"><div className="consumption-head"><span></span><b>Нарачано</b><b>Земено</b></div><ConsumptionRow label={productName('p025')} ordered={formatPackages(orderedTotals.p025Packages,orderedTotals.p025Pieces)} taken={formatPackages(takenTotals.p025Packages,takenTotals.p025Pieces)}/><ConsumptionRow label={productName('p15')} ordered={formatPackages(orderedTotals.p15Packages,orderedTotals.p15Pieces)} taken={formatPackages(takenTotals.p15Packages,takenTotals.p15Pieces)}/><ConsumptionRow label="Флаери" ordered={`${orderedTotals.flyers} парчиња`} taken={`${takenTotals.flyers} парчиња`}/></div></section><section className="client-history"><div className="section-title"><div><h3>Историја на нарачки</h3><p>Кога и што има нарачано клиентот, вклучително и гратис</p></div></div>{orders.length===0?<Empty text="Клиентот сè уште нема нарачки."/>:<div className="client-order-list">{orders.map(order=><article key={order.id}><div className="client-order-head"><div><span>{order.number}</span><strong>{order.date}</strong></div><span className={statusClass(order.status)}>{order.status}</span></div><div className="client-order-products"><span>{productName('p025')} <b>{formatPackages(order.qty025,order.qty025Pieces||0)}</b></span><span>Гратис {productName('p025')} <b>{formatPackages(order.free025,order.free025Pieces||0)}</b></span><span>{productName('p15')} <b>{formatPackages(order.qty15,order.qty15Pieces||0)}</b></span><span>Гратис {productName('p15')} <b>{formatPackages(order.free15||0,order.free15Pieces||0)}</b></span><span>Флаери <b>{order.flyers} пар.</b></span></div>{order.note&&<p>{order.note}</p>}</article>)}</div>}</section></div></Modal>
}

const ConsumptionRow=({label,ordered,taken}:{label:string;ordered:string;taken:string})=><div className="consumption-row"><strong>{label}</strong><span>{ordered}</span><span>{taken}</span></div>

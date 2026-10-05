import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Building2, ChevronRight, Mail, MapPin, PackageCheck, Pencil, Phone, Plus, Save, ShoppingBag, Truck } from 'lucide-react'
import type { AppState, Client, Order, OrderStatus } from '../types'
import { normalizeClientName, sanitizeClient } from '../lib/clients'
import { productName } from '../lib/logic'
import { Empty, Field, Modal, PageHeader } from './UI'
import './ClientsPage.css'

const takenStatuses = new Set<OrderStatus>(['Спакувана','Излезена','Испратена','Доставена'])
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

type ClientsPageProps = {
  state:AppState
  onSaveClient:(client:Client,previousName?:string)=>void
}

const emptyTotals=():ProductTotals=>({p025Packages:0,p025Pieces:0,p15Packages:0,p15Pieces:0,flyers:0})
const blankClient=():Client=>({id:crypto.randomUUID(),name:'',city:'',phone:'',contactPerson:'',address:'',taxNumber:'',companyNumber:'',bankAccount:'',email:'',cargoInfo:'',note:''})

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
    const key=normalizeClientName(order.client)
    const existing=ordersByClient.get(key)
    if(existing)existing.push(order)
    else ordersByClient.set(key,[order])
  }
  return state.clients.map(client=>{
    const orders=(ordersByClient.get(normalizeClientName(client.name))||[]).toSorted((a,b)=>b.date.localeCompare(a.date)||b.number.localeCompare(a.number))
    const validOrders=orders.filter(order=>order.status!=='Откажана')
    const taken=validOrders.filter(order=>order.stockDeducted||takenStatuses.has(order.status))
    const orderedTotals=emptyTotals()
    const takenTotals=emptyTotals()
    for(const order of validOrders)addOrder(orderedTotals,order)
    for(const order of taken)addOrder(takenTotals,order)
    return {client,orders,taken,orderedTotals,takenTotals,lastOrder:orders[0]}
  }).toSorted((a,b)=>(b.lastOrder?.date||'').localeCompare(a.lastOrder?.date||'')||a.client.name.localeCompare(b.client.name,'mk'))
}

export function ClientsPage({state,onSaveClient}:ClientsPageProps){
  const summaries=useMemo(()=>buildSummaries(state),[state])
  const [selectedId,setSelectedId]=useState<string|null>(null)
  const [editor,setEditor]=useState<{client:Client;previousName?:string}|null>(null)
  const selected=summaries.find(summary=>summary.client.id===selectedId)||null
  const save=(client:Client)=>{onSaveClient(client,editor?.previousName);setEditor(null);setSelectedId(client.id)}
  return <><PageHeader title="Клиенти" action={<button type="button" className="primary" onClick={()=>setEditor({client:blankClient()})}><Plus size={18}/> Нов клиент</button>}/>{summaries.length===0?<Empty text="Нема внесени клиенти."/>:<div className="client-grid">{summaries.map(summary=><ClientCard key={summary.client.id} summary={summary} onOpen={()=>setSelectedId(summary.client.id)}/>)}</div>}{selected&&!editor&&<ClientDetails summary={selected} onClose={()=>setSelectedId(null)} onEdit={()=>setEditor({client:selected.client,previousName:selected.client.name})}/>} {editor&&<Modal title={editor.previousName?'Уреди клиентско досие':'Нов клиент'} onClose={()=>setEditor(null)}><ClientEditor client={editor.client} allClients={state.clients} onSave={save} onCancel={()=>setEditor(null)}/></Modal>}</>
}

function ClientCard({summary,onOpen}:{summary:ClientSummary;onOpen:()=>void}){
  const {client,orders,taken,orderedTotals,lastOrder}=summary
  return <button type="button" className="card client-card client-card-button" onClick={onOpen}><div className="client-card-head"><div className="avatar">{client.name.slice(0,2).toUpperCase()}</div><ChevronRight/></div><h3>{client.name}</h3><p><MapPin size={14}/>{client.city||'Нема внесено место'}</p><div className="client-card-stats"><span>Нарачки <b>{orders.length}</b></span><span>Земени <b>{taken.length}</b></span><span>Последна <b>{lastOrder?.date||'—'}</b></span></div><div className="client-product-preview"><span>{productName('p025')} <b>{orderedTotals.p025Packages} пак.</b></span><span>{productName('p15')} <b>{orderedTotals.p15Packages} пак.</b></span><span>Флаери <b>{orderedTotals.flyers}</b></span></div><small>{client.phone||'Нема внесен телефон'} • {client.contactPerson||'Нема контакт лице'}</small></button>
}

function ClientDetails({summary,onClose,onEdit}:{summary:ClientSummary;onClose:()=>void;onEdit:()=>void}){
  const {client,orders,taken,orderedTotals,takenTotals,lastOrder}=summary
  return <Modal title={client.name} onClose={onClose}><div className="client-detail"><div className="client-detail-actions"><div><span>Клиентско досие</span><small>Фирмени, контактни и карго-податоци</small></div><button type="button" className="ghost" onClick={onEdit}><Pencil size={16}/> Уреди досие</button></div><section className="client-dossier"><DossierItem icon={<Building2 size={17}/>} label="Матичен број" value={client.companyNumber}/><DossierItem label="ЕДБ" value={client.taxNumber}/><DossierItem icon={<MapPin size={17}/>} label="Адреса" value={[client.address,client.city].filter(Boolean).join(', ')}/><DossierItem label="Лице за контакт" value={client.contactPerson}/><DossierItem icon={<Phone size={17}/>} label="Телефон" value={client.phone}/><DossierItem icon={<Mail size={17}/>} label="E-mail" value={client.email}/><DossierItem label="Трансакциска сметка" value={client.bankAccount}/><DossierItem label="Карго / достава" value={client.cargoInfo}/><DossierItem wide label="Забелешка" value={client.note}/></section><div className="client-detail-contact"><span><MapPin size={16}/>{client.city||'Нема внесено место'}{client.address?` • ${client.address}`:''}</span><span>{client.contactPerson||'Нема контакт лице'} • {client.phone||'Нема телефон'}</span></div><div className="client-detail-metrics"><div><ShoppingBag/><span>Вкупно нарачки<strong>{orders.length}</strong></span></div><div><PackageCheck/><span>Земени од магацин<strong>{taken.length}</strong></span></div><div><Truck/><span>Последна нарачка<strong>{lastOrder?.date||'—'}</strong></span></div></div><section className="client-consumption"><div className="section-title"><div><h3>Потрошувачка по производ</h3><p>Основа за идна анализа на продажба и планирање залиха</p></div></div><div className="client-consumption-table"><div className="consumption-head"><span></span><b>Нарачано</b><b>Земено</b></div><ConsumptionRow label={productName('p025')} ordered={formatPackages(orderedTotals.p025Packages,orderedTotals.p025Pieces)} taken={formatPackages(takenTotals.p025Packages,takenTotals.p025Pieces)}/><ConsumptionRow label={productName('p15')} ordered={formatPackages(orderedTotals.p15Packages,orderedTotals.p15Pieces)} taken={formatPackages(takenTotals.p15Packages,takenTotals.p15Pieces)}/><ConsumptionRow label="Флаери" ordered={`${orderedTotals.flyers} парчиња`} taken={`${takenTotals.flyers} парчиња`}/></div></section><section className="client-history"><div className="section-title"><div><h3>Историја на нарачки</h3><p>Кога и што има нарачано клиентот, вклучително и гратис</p></div></div>{orders.length===0?<Empty text="Клиентот сè уште нема нарачки."/>:<div className="client-order-list">{orders.map(order=><article key={order.id}><div className="client-order-head"><div><span>{order.number}</span><strong>{order.date}</strong></div><span className={statusClass(order.status)}>{order.status}</span></div><div className="client-order-products"><span>{productName('p025')} <b>{formatPackages(order.qty025,order.qty025Pieces||0)}</b></span><span>Гратис {productName('p025')} <b>{formatPackages(order.free025,order.free025Pieces||0)}</b></span><span>{productName('p15')} <b>{formatPackages(order.qty15,order.qty15Pieces||0)}</b></span><span>Гратис {productName('p15')} <b>{formatPackages(order.free15||0,order.free15Pieces||0)}</b></span><span>Флаери <b>{order.flyers} пар.</b></span></div>{order.note&&<p>{order.note}</p>}</article>)}</div>}</section></div></Modal>
}

function ClientEditor({client,allClients,onSave,onCancel}:{client:Client;allClients:Client[];onSave:(client:Client)=>void;onCancel:()=>void}){
  const [form,setForm]=useState<Client>(()=>({...client}))
  const [message,setMessage]=useState('')
  const patch=(field:keyof Client,value:string)=>setForm(current=>({...current,[field]:value}))
  const submit=(event:FormEvent)=>{event.preventDefault();const saved=sanitizeClient(form);if(!saved.name){setMessage('Внеси име на фирма.');return}if(allClients.some(item=>item.id!==saved.id&&normalizeClientName(item.name)===normalizeClientName(saved.name))){setMessage('Веќе постои клиент со ова име.');return}onSave(saved)}
  return <form className="client-editor form-grid" onSubmit={submit}><div className="client-editor-intro"><Building2/><div><strong>Целосно клиентско досие</strong><small>Овие податоци автоматски ќе се користат во испратницата.</small></div></div><Field label="Име на фирма *"><input required value={form.name} onChange={event=>patch('name',event.target.value)}/></Field><Field label="Место / град"><input value={form.city} onChange={event=>patch('city',event.target.value)}/></Field><Field label="Матичен број"><input inputMode="numeric" value={form.companyNumber||''} onChange={event=>patch('companyNumber',event.target.value)}/></Field><Field label="ЕДБ"><input value={form.taxNumber||''} onChange={event=>patch('taxNumber',event.target.value)}/></Field><Field label="Адреса"><input value={form.address} onChange={event=>patch('address',event.target.value)}/></Field><Field label="Лице за контакт"><input value={form.contactPerson} onChange={event=>patch('contactPerson',event.target.value)}/></Field><Field label="Телефон"><input type="tel" value={form.phone} onChange={event=>patch('phone',event.target.value)}/></Field><Field label="E-mail"><input type="email" value={form.email||''} onChange={event=>patch('email',event.target.value)}/></Field><Field label="Трансакциска сметка"><input value={form.bankAccount||''} onChange={event=>patch('bankAccount',event.target.value)}/></Field><Field label="Карго / информации за достава"><textarea placeholder="Карго компанија, терминал, контакт, напомена за преземање..." value={form.cargoInfo||''} onChange={event=>patch('cargoInfo',event.target.value)}/></Field><Field label="Забелешка"><textarea value={form.note||''} onChange={event=>patch('note',event.target.value)}/></Field>{message&&<div className="client-editor-error">{message}</div>}<div className="modal-actions"><button type="button" className="ghost" onClick={onCancel}>Откажи</button><button className="primary"><Save size={17}/> Зачувај досие</button></div></form>
}

const DossierItem=({label,value,icon,wide=false}:{label:string;value?:string;icon?:ReactNode;wide?:boolean})=><div className={wide?'wide':''}>{icon}<span>{label}<strong>{value||'—'}</strong></span></div>
const ConsumptionRow=({label,ordered,taken}:{label:string;ordered:string;taken:string})=><div className="consumption-row"><strong>{label}</strong><span>{ordered}</span><span>{taken}</span></div>

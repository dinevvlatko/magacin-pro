import type { AppState, Order, ProductKey, StockUnit } from '../types'
export const normalize=(total:number,perPackage:number):StockUnit=>({packages:Math.floor(total/perPackage),pieces:total%perPackage,total,perPackage})
export const breakdown=(total:number,per:number)=>`${Math.floor(total/per)} пак. + ${total%per} пар.`
export const allPacked=(o:Order)=>o.packed.regular025&&o.packed.bib15&&o.packed.free025&&o.packed.flyers
export const deductStatuses=new Set(['Излезена','Испратена','Доставена'])
export const activeStatuses=new Set(['Нова','Во подготовка','Спакувана','Излезена','Испратена'])
export const reserved=(s:AppState)=>s.orders.filter(o=>activeStatuses.has(o.status)&&!o.stockDeducted).reduce((a,o)=>({p025:a.p025+o.qty025+o.free025,p15:a.p15+o.qty15,flyers:a.flyers+o.flyers}),{p025:0,p15:0,flyers:0})
export const available=(s:AppState)=>{const r=reserved(s);return {p025:s.warehouse.p025.total-r.p025,p15:s.warehouse.p15.total-r.p15,flyers:s.warehouse.flyers-r.flyers}}
export const productName=(p:ProductKey)=>p==='p025'?'0.25 L':p==='p15'?'1.5 L BIB':'Флаери'

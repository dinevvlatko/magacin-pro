import { describe, expect, it } from 'vitest'
import type { AppState, Movement, Order } from '../types'
import { mergeIndependentStates } from './stateImport'

const order=(id:string,number:string,client:string):Order=>({id,number,client,city:'Скопје',date:'2026-08-17',qty025:1,qty025Pieces:0,qty15:0,qty15Pieces:0,free025:0,free025Pieces:0,free15:0,free15Pieces:0,flyers:0,note:'',status:'Нова',packed:{regular025:false,bib15:false,free025:false,free15:false,flyers:false},stockDeducted:false})
const movement=(id:string,orderNumber:string,product:'p025'|'p15'='p025'):Movement=>({id,date:'2026-08-17',product,type:'Влез',packages:1,pieces:0,party:'Тим',orderNumber,note:'Производство'})
const state=(orders:Order[]=[],movements:Movement[]=[]):AppState=>({warehouse:{p025:{packages:100,pieces:0,total:1500,perPackage:15},p15:{packages:50,pieces:0,total:300,perPackage:6},flyers:2000},orders,clients:[],movements,stockThresholds:{p025:300,p15:60,flyers:500}})

describe('mergeIndependentStates',()=>{
 it('keeps shared stock totals and imports unique device records',()=>{
  const shared=state([order('shared-order','PG-2026-0001','Алфа')])
  shared.clients=[{id:'shared-client',name:'Алфа',city:'Скопје',phone:'',contactPerson:'',address:''}]
  const local=state([order('local-order','PG-2026-0002','Бета')])
  local.warehouse.p025.total=15;local.warehouse.p025.packages=1
  local.clients=[{id:'local-client',name:'Бета',city:'Битола',phone:'070000000',contactPerson:'Бојан',address:'Улица 1'}]
  const merged=mergeIndependentStates(shared,local)
  expect(merged.warehouse.p025.total).toBe(1500)
  expect(merged.orders.map(item=>item.client)).toEqual(expect.arrayContaining(['Алфа','Бета']))
  expect(merged.clients.find(client=>client.name==='Бета')?.phone).toBe('070000000')
 })

 it('deduplicates the same business order even when device ids differ',()=>{
  const merged=mergeIndependentStates(state([order('shared-id','PG-2026-0001','Алфа')]),state([order('local-id','PG-2026-0001','Алфа')]))
  expect(merged.orders.filter(item=>item.number==='PG-2026-0001')).toHaveLength(1)
 })

 it('renumbers real order and receipt collisions without splitting receipt lines',()=>{
  const shared=state([order('shared-order','PG-2026-0001','Алфа')],[movement('shared-line','PR-0002')])
  const localOrder=order('local-order','PG-2026-0001','Бета')
  const local=state([localOrder],[movement('local-line-a','PR-0002'),movement('local-line-b','PR-0002','p15')])
  const merged=mergeIndependentStates(shared,local)
  const importedOrder=merged.orders.find(item=>item.id==='local-order')
  expect(importedOrder?.number).not.toBe('PG-2026-0001')
  const importedReceiptNumbers=merged.movements.filter(item=>item.id.startsWith('local-line')).map(item=>item.orderNumber)
  expect(new Set(importedReceiptNumbers).size).toBe(1)
  expect(importedReceiptNumbers[0]).not.toBe('PR-0002')
 })

 it('does not import the generated local opening balance as a receipt',()=>{
  const shared=state()
  const local=state()
  local.warehouse.p025={packages:1,pieces:0,total:15,perPackage:15}
  const merged=mergeIndependentStates(shared,local)
  expect(merged.movements.filter(item=>item.id.startsWith('baseline-pr-0001-'))).toHaveLength(3)
  expect(merged.movements.filter(item=>item.orderNumber!=='PR-0001')).toHaveLength(0)
 })
})

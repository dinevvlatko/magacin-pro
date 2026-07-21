import { describe,expect,it } from 'vitest'
import type { AppState,Order } from '../types'
import { allPacked, available, canReplaceOrder, canReserveOrder, deductOrderStock, hydrateState, reconcileWaitingOrders, returnOrderStock } from './logic'
import { mergeConcurrentStates,StateMergeError } from './stateMerge'
import { orderQrUrl } from './orderQr'
import { formatDocumentDate } from './date'

const order=(id:string,number:string,qty025=1):Order=>({id,number,client:id,city:'Скопје',date:'2026-07-15',qty025,qty025Pieces:0,qty15:0,qty15Pieces:0,free025:0,free025Pieces:0,flyers:0,note:'',status:'Нова',packed:{regular025:false,bib15:false,free025:false,flyers:false},stockDeducted:false})
const state=(orders:Order[]=[],p025=1500):AppState=>({warehouse:{p025:{total:p025,packages:Math.floor(p025/15),pieces:p025%15,perPackage:15},p15:{total:600,packages:100,pieces:0,perPackage:6},flyers:3000},orders,clients:[],movements:[]})

describe('conflict-safe warehouse merge',()=>{
 it('keeps both concurrent orders and assigns unique sequential numbers',()=>{
  const base=state(),local=state([order('local','PG-2026-0001')]),remote=state([order('remote','PG-2026-0001')])
  const merged=mergeConcurrentStates(base,local,remote)
  expect(merged.orders).toHaveLength(2)
  expect(new Set(merged.orders.map(item=>item.number)).size).toBe(2)
  expect(merged.orders.find(item=>item.id==='remote')?.number).toBe('PG-2026-0001')
  expect(merged.orders.find(item=>item.id==='local')?.number).toBe('PG-2026-0002')
 })

 it('merges checkbox changes made on different locations',()=>{
  const original=order('one','PG-2026-0001'),base=state([original])
  const local=state([{...original,packed:{...original.packed,regular025:true}}])
  const remote=state([{...original,packed:{...original.packed,bib15:true}}])
  const merged=mergeConcurrentStates(base,local,remote)
  expect(merged.orders[0].packed.regular025).toBe(true)
  expect(merged.orders[0].packed.bib15).toBe(true)
 })

 it('adds independent stock deductions instead of overwriting one',()=>{
  const first=order('first','PG-2026-0001'),second=order('second','PG-2026-0002'),base=state([first,second])
  const local=deductOrderStock(base,first,'Спакувана')!,remote=deductOrderStock(base,second,'Спакувана')!
  const merged=mergeConcurrentStates(base,local,remote)
  expect(merged.warehouse.p025.total).toBe(1470)
  expect(merged.orders.every(item=>item.stockDeducted)).toBe(true)
  expect(merged.movements.filter(item=>item.product==='p025')).toHaveLength(2)
 })

 it('rejects two reservations that together exceed free stock',()=>{
  const base=state([],15),local=state([order('local','PG-2026-0001')],15),remote=state([order('remote','PG-2026-0001')],15)
  expect(()=>mergeConcurrentStates(base,local,remote)).toThrow(StateMergeError)
 })
})

describe('stock safeguards',()=>{
 it('formats specification dates as dd/mm/yyyy',()=>expect(formatDocumentDate('2026-07-15')).toBe('15/07/2026'))
 it('blocks a new order larger than the currently free stock',()=>expect(canReserveOrder(state([],15),order('big','PG-2026-0001',2))).toBe(false))
 it('keeps waiting orders as soft demand without making available stock negative',()=>{
  const waiting={...order('waiting','PG-2026-0001',2),status:'Чека залиха' as const}
  expect(available(state([waiting],15)).p025).toBe(15)
 })
 it('activates waiting orders FIFO when a receipt creates enough free stock',()=>{
  const first={...order('first','PG-2026-0001',1),status:'Чека залиха' as const},second={...order('second','PG-2026-0002',1),status:'Чека залиха' as const}
  const reconciled=reconcileWaitingOrders(state([second,first],15))
  expect(reconciled.orders.find(item=>item.id==='first')?.status).toBe('Нова')
  expect(reconciled.orders.find(item=>item.id==='second')?.status).toBe('Чека залиха')
 })
 it('migrates old overbooked active orders to waiting status on load',()=>{
  const first=order('first','PG-2026-0001',1),second=order('second','PG-2026-0002',1),hydrated=hydrateState(state([first,second],15))
  expect(hydrated.orders.find(item=>item.id==='first')?.status).toBe('Нова')
  expect(hydrated.orders.find(item=>item.id==='second')?.status).toBe('Чека залиха')
  expect(available(hydrated).p025).toBe(0)
 })
 it('restores deducted stock when an order is cancelled',()=>{
  const original=order('one','PG-2026-0001'),packed=deductOrderStock(state([original]),original,'Спакувана')!
  const restored=returnOrderStock(packed,packed.orders[0])
  expect(restored.warehouse.p025.total).toBe(1500)
  expect(restored.orders[0].status).toBe('Откажана')
  expect(restored.movements.some(item=>item.type==='Враќање')).toBe(true)
 })
 it('deducts and restores free BiB together with regular BiB',()=>{
  const original={...order('bib','PG-2026-0001'),free15:2,free15Pieces:1}
  const packed=deductOrderStock(state([original]),original,'Спакувана')!
  expect(packed.warehouse.p15.total).toBe(587)
  expect(packed.movements.find(item=>item.product==='p15')).toMatchObject({packages:2,pieces:1})
  expect(returnOrderStock(packed,packed.orders[0]).warehouse.p15.total).toBe(600)
 })
 it('allows an overbooked order correction only when it does not worsen the shortage',()=>{
  const original=order('original','PG-2026-0001',2),other=order('other','PG-2026-0002',2),current=state([original,other],15)
  expect(canReplaceOrder(current,original,{...original,qty025:1})).toBe(true)
  expect(canReplaceOrder(current,original,{...original,qty025:3})).toBe(false)
 })
 it('does not require zero-quantity rows to be checked',()=>{
  const oneItem={...order('one','PG-2026-0001'),packed:{regular025:true,bib15:false,free025:false,free15:false,flyers:false}}
  expect(allPacked(oneItem)).toBe(true)
 })
 it('creates one deep link QR for the complete order',()=>expect(orderQrUrl('order-123','https://magacin-pro-ten.vercel.app')).toBe('https://magacin-pro-ten.vercel.app/?order=order-123'))
 it('removes the former package-scan archive while loading data',()=>{
  const legacy={...order('legacy','PG-2026-0001'),scannedPackages:{regular025:[1,2,3]}}
  expect('scannedPackages' in hydrateState(state([legacy])) .orders[0]).toBe(false)
 })
})

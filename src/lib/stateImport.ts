import type { AppState, Client, Movement, Order } from '../types'
import { hydrateState } from './logic'

const normalized=(value:string)=>value.trim().toLocaleLowerCase('mk-MK')
const orderIdentity=(order:Order)=>JSON.stringify({
 client:normalized(order.client),city:normalized(order.city),date:order.date,
 qty025:order.qty025,qty025Pieces:order.qty025Pieces||0,qty15:order.qty15,qty15Pieces:order.qty15Pieces||0,
 free025:order.free025,free025Pieces:order.free025Pieces||0,free15:order.free15||0,free15Pieces:order.free15Pieces||0,
 flyers:order.flyers,note:normalized(order.note),
})
const movementIdentity=(movement:Movement)=>JSON.stringify({date:movement.date,product:movement.product,type:movement.type,packages:movement.packages,pieces:movement.pieces,party:normalized(movement.party),orderNumber:movement.orderNumber,note:normalized(movement.note)})
const receiptLineIdentity=(movement:Movement)=>JSON.stringify({date:movement.date,product:movement.product,type:movement.type,packages:movement.packages,pieces:movement.pieces,party:normalized(movement.party),note:normalized(movement.note)})
const receiptPattern=/^PR-\d{4}$/
const isGeneratedBaseline=(movement:Movement)=>movement.id.startsWith('baseline-pr-0001-')

const allocateNumber=(preferred:string,used:Set<string>)=>{
 const match=preferred.match(/^(.*?)(\d+)$/)
 const prefix=match?.[1]||`PG-${new Date().getFullYear()}-`,width=match?.[2].length||4
 let next=0
 used.forEach(value=>{const candidate=value.match(/^(.*?)(\d+)$/);if(candidate?.[1]===prefix)next=Math.max(next,Number(candidate[2]))})
 let value=''
 do{next+=1;value=`${prefix}${String(next).padStart(width,'0')}`}while(used.has(value))
 used.add(value)
 return value
}

const mergeClients=(primary:Client[],imported:Client[])=>{
 const result=primary.map(client=>({...client}))
 imported.forEach(candidate=>{
  const index=result.findIndex(client=>normalized(client.name)===normalized(candidate.name))
  if(index<0){result.push({...candidate});return}
  const current=result[index]
  result[index]={...current,city:current.city||candidate.city,phone:current.phone||candidate.phone,contactPerson:current.contactPerson||candidate.contactPerson,address:current.address||candidate.address}
 })
 return result
}

/** Imports independent device history while keeping the shared warehouse totals authoritative. */
export const mergeIndependentStates=(primaryInput:AppState,importedInput:AppState):AppState=>{
 const primary=hydrateState(primaryInput),imported=hydrateState(importedInput)
 const orders=primary.orders.map(order=>({...order,packed:{...order.packed}}))
 const usedOrderNumbers=new Set(orders.map(order=>order.number))
 const orderNumberMap=new Map<string,string>()

 imported.orders.forEach(candidate=>{
  if(orders.some(order=>order.id===candidate.id))return
  const sameNumber=orders.find(order=>order.number===candidate.number)
  if(sameNumber&&orderIdentity(sameNumber)===orderIdentity(candidate))return
  const number=usedOrderNumbers.has(candidate.number)?allocateNumber(candidate.number,usedOrderNumbers):candidate.number
  usedOrderNumbers.add(number)
  if(number!==candidate.number)orderNumberMap.set(candidate.number,number)
  orders.push({...candidate,number,packed:{...candidate.packed}})
 })

 const movements=primary.movements.map(movement=>({...movement}))
 const usedMovementIds=new Set(movements.map(movement=>movement.id))
 const usedMovementIdentities=new Set(movements.map(movementIdentity))
 const usedReceiptNumbers=new Set(movements.filter(movement=>receiptPattern.test(movement.orderNumber)).map(movement=>movement.orderNumber))
 const receiptNumberMap=new Map<string,string>()
 const primaryReceiptLines=new Map<string,Set<string>>()
 movements.filter(movement=>receiptPattern.test(movement.orderNumber)).forEach(movement=>{
  const lines=primaryReceiptLines.get(movement.orderNumber)||new Set<string>();lines.add(receiptLineIdentity(movement));primaryReceiptLines.set(movement.orderNumber,lines)
 })
 const importedReceiptLines=new Map<string,Set<string>>()
 imported.movements.filter(movement=>receiptPattern.test(movement.orderNumber)).forEach(movement=>{
  const lines=importedReceiptLines.get(movement.orderNumber)||new Set<string>();lines.add(receiptLineIdentity(movement));importedReceiptLines.set(movement.orderNumber,lines)
 })

 imported.movements.forEach(candidate=>{
  if(isGeneratedBaseline(candidate))return
  if(usedMovementIds.has(candidate.id))return
  let orderNumber=orderNumberMap.get(candidate.orderNumber)||candidate.orderNumber
  if(receiptPattern.test(candidate.orderNumber)&&usedReceiptNumbers.has(candidate.orderNumber)){
   const primaryLines=primaryReceiptLines.get(candidate.orderNumber)||new Set<string>()
   const importedLines=importedReceiptLines.get(candidate.orderNumber)||new Set<string>()
   const sameReceipt=primaryLines.size===importedLines.size&&[...importedLines].every(line=>primaryLines.has(line))
   if(sameReceipt)return
   orderNumber=receiptNumberMap.get(candidate.orderNumber)||allocateNumber(candidate.orderNumber,usedReceiptNumbers)
   receiptNumberMap.set(candidate.orderNumber,orderNumber)
  }
  const movement={...candidate,orderNumber}
  const identity=movementIdentity(movement)
  if(usedMovementIdentities.has(identity))return
  usedMovementIds.add(movement.id);usedMovementIdentities.add(identity);movements.push(movement)
 })

 return hydrateState({...primary,warehouse:primary.warehouse,stockThresholds:primary.stockThresholds,orders,clients:mergeClients(primary.clients,imported.clients),movements})
}

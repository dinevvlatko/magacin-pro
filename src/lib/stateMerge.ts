import type { AppState, Client, Movement, Order, StockUnit } from '../types'
import { available } from './logic'

export class StateMergeError extends Error {}

const same=(left:unknown,right:unknown)=>JSON.stringify(left)===JSON.stringify(right)
const isRecord=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)

const mergeValue=(base:unknown,local:unknown,remote:unknown,path:string):unknown=>{
 if(same(local,remote))return local
 if(same(local,base))return remote
 if(same(remote,base))return local
 if(isRecord(base)&&isRecord(local)&&isRecord(remote)){
  const result:Record<string,unknown>={}
  for(const key of new Set([...Object.keys(base),...Object.keys(local),...Object.keys(remote)]))result[key]=mergeValue(base[key],local[key],remote[key],`${path}.${key}`)
  return result
 }
 throw new StateMergeError(`Истовремена промена на ${path}. Освежи и повтори ја последната промена.`)
}

const mergeEntities=<T extends {id:string}>(base:T[],local:T[],remote:T[],label:string):T[]=>{
 const baseMap=new Map(base.map(item=>[item.id,item])),localMap=new Map(local.map(item=>[item.id,item])),remoteMap=new Map(remote.map(item=>[item.id,item]))
 const result:T[]=[]
 for(const id of new Set([...baseMap.keys(),...localMap.keys(),...remoteMap.keys()])){
  const before=baseMap.get(id),mine=localMap.get(id),theirs=remoteMap.get(id)
  if(!before){
   if(mine&&theirs){if(!same(mine,theirs))throw new StateMergeError(`Конфликт при креирање ${label}.`);result.push(mine)}
   else if(mine||theirs)result.push((mine||theirs) as T)
   continue
  }
  if(!mine&&!theirs)continue
  if(!mine){if(!same(theirs,before))throw new StateMergeError(`${label} е променета на друга локација и не може да се избрише.`);continue}
  if(!theirs){if(!same(mine,before))throw new StateMergeError(`${label} е избришана на друга локација.`);continue}
  result.push(mergeValue(before,mine,theirs,label) as T)
 }
 return result
}

const normalize=(total:number,perPackage:number):StockUnit=>({total,perPackage,packages:Math.floor(total/perPackage),pieces:total%perPackage})
const mergeWarehouse=(base:AppState['warehouse'],local:AppState['warehouse'],remote:AppState['warehouse']):AppState['warehouse']=>{
 const p025=remote.p025.total+(local.p025.total-base.p025.total)
 const p15=remote.p15.total+(local.p15.total-base.p15.total)
 const flyers=remote.flyers+(local.flyers-base.flyers)
 if(p025<0||p15<0||flyers<0)throw new StateMergeError('Друга локација веќе ја потрошила потребната залиха. Последната промена не е зачувана.')
 return {p025:normalize(p025,15),p15:normalize(p15,6),flyers}
}

const renumberDuplicateOrders=(orders:Order[],remote:Order[]):Order[]=>{
 const remoteIds=new Set(remote.map(order=>order.id));let next=Math.max(0,...orders.map(order=>Number(order.number.match(/PG-\d{4}-(\d+)$/)?.[1]||0)))
 const byNumber=new Map<string,Order[]>()
 orders.forEach(order=>byNumber.set(order.number,[...(byNumber.get(order.number)||[]),order]))
 const replacements=new Map<string,string>()
 byNumber.forEach(group=>{if(group.length<2)return;const keep=group.find(order=>remoteIds.has(order.id))||group[0];group.filter(order=>order.id!==keep.id).forEach(order=>replacements.set(order.id,`PG-${new Date().getFullYear()}-${String(++next).padStart(4,'0')}`))})
 return orders.map(order=>replacements.has(order.id)?{...order,number:replacements.get(order.id)!}:order)
}

const renumberDuplicateReceipts=(movements:Movement[],base:Movement[],remote:Movement[]):Movement[]=>{
 const baseIds=new Set(base.map(movement=>movement.id)),remoteIdsByNumber=new Map<string,Set<string>>();let next=Math.max(0,...movements.map(movement=>Number(movement.orderNumber.match(/^PR-(\d{4})$/)?.[1]||0)))
 remote.filter(movement=>/^PR-\d{4}$/.test(movement.orderNumber)).forEach(movement=>remoteIdsByNumber.set(movement.orderNumber,new Set([...(remoteIdsByNumber.get(movement.orderNumber)||[]),movement.id])))
 const localGroups=new Map<string,Movement[]>()
 movements.filter(movement=>!baseIds.has(movement.id)&&/^PR-\d{4}$/.test(movement.orderNumber)).forEach(movement=>localGroups.set(movement.orderNumber,[...(localGroups.get(movement.orderNumber)||[]),movement]))
 const replacements=new Map<string,string>()
 localGroups.forEach((group,number)=>{const remoteIds=remoteIdsByNumber.get(number);if(remoteIds&&group.some(movement=>!remoteIds.has(movement.id))){const replacement=`PR-${String(++next).padStart(4,'0')}`;group.forEach(movement=>replacements.set(movement.id,replacement))}})
 return movements.map(movement=>replacements.has(movement.id)?{...movement,orderNumber:replacements.get(movement.id)!}:movement)
}

const dedupeClients=(clients:Client[],remote:Client[])=>{
 const remoteNames=new Map(remote.map(client=>[client.name.trim().toLowerCase(),client.id])),seen=new Set<string>()
 return clients.filter(client=>{const name=client.name.trim().toLowerCase();if(seen.has(name))return false;const preferred=remoteNames.get(name);if(preferred&&preferred!==client.id)return false;seen.add(name);return true})
}

const shortages=(state:AppState)=>{const free=available(state);return {p025:Math.max(0,-free.p025),p15:Math.max(0,-free.p15),flyers:Math.max(0,-free.flyers)}}

export const mergeConcurrentStates=(base:AppState,local:AppState,remote:AppState):AppState=>{
 const orders=renumberDuplicateOrders(mergeEntities(base.orders,local.orders,remote.orders,'нарачката'),remote.orders)
 const movements=renumberDuplicateReceipts(mergeEntities(base.movements,local.movements,remote.movements,'движењето'),base.movements,remote.movements)
 const clients=dedupeClients(mergeEntities(base.clients,local.clients,remote.clients,'клиентот'),remote.clients)
 const merged:AppState={warehouse:mergeWarehouse(base.warehouse,local.warehouse,remote.warehouse),orders,clients,movements}
 const mergedShortage=shortages(merged),localShortage=shortages(local),remoteShortage=shortages(remote)
 for(const product of ['p025','p15','flyers'] as const)if(mergedShortage[product]>Math.max(localShortage[product],remoteShortage[product]))throw new StateMergeError('Две локации резервираа иста залиха во ист момент. Последната нарачка не е зачувана; провери ја новата слободна количина.')
 return merged
}

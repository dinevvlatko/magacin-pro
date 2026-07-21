import type { AppState } from '../types'
import { demoState } from './data'
import { deductOrderStock, deductStatuses, hydrateState } from './logic'
const KEY='magacin-pro-v3'
const LEGACY_KEYS=['magacin-pro-v2','magacin-pro-v1']
const deductPackedOrders=(state:AppState)=>state.orders.reduce((current,o)=>{if(!deductStatuses.has(o.status)||o.stockDeducted)return current;const currentOrder=current.orders.find(x=>x.id===o.id);return currentOrder?deductOrderStock(current,currentOrder)??current:current},state)
export const loadState=():AppState=>{try{const current=localStorage.getItem(KEY);if(current)return deductPackedOrders(hydrateState(JSON.parse(current) as AppState));const legacy=LEGACY_KEYS.map(key=>localStorage.getItem(key)).find(Boolean);return legacy?deductPackedOrders(hydrateState(JSON.parse(legacy) as AppState)):hydrateState(demoState())}catch{return hydrateState(demoState())}}
export const saveState=(state:AppState)=>{try{localStorage.setItem(KEY,JSON.stringify(state))}catch{/* Storage can be unavailable or full. */}}
export const clearState=()=>{localStorage.removeItem(KEY);LEGACY_KEYS.forEach(key=>localStorage.removeItem(key))}

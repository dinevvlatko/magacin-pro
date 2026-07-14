import type { AppState } from '../types'
import { demoState } from './data'
import { deductOrderStock, deductStatuses } from './logic'
const KEY='magacin-pro-v3'
const LEGACY_KEYS=['magacin-pro-v2','magacin-pro-v1']
const hydrate=(state:AppState):AppState=>({...state,orders:state.orders.map(o=>({...o,qty025Pieces:o.qty025Pieces||0,qty15Pieces:o.qty15Pieces||0,free025Pieces:o.free025Pieces||0}))})
const deductPackedOrders=(state:AppState)=>state.orders.reduce((current,o)=>{if(!deductStatuses.has(o.status)||o.stockDeducted)return current;const currentOrder=current.orders.find(x=>x.id===o.id);return currentOrder?deductOrderStock(current,currentOrder)??current:current},state)
export const loadState=():AppState=>{try{const current=localStorage.getItem(KEY);if(current)return hydrate(JSON.parse(current) as AppState);const legacy=LEGACY_KEYS.map(key=>localStorage.getItem(key)).find(Boolean);return legacy?deductPackedOrders(hydrate(JSON.parse(legacy) as AppState)):demoState()}catch{return demoState()}}
export const saveState=(state:AppState)=>{try{localStorage.setItem(KEY,JSON.stringify(state))}catch{/* Storage can be unavailable or full. */}}
export const clearState=()=>{localStorage.removeItem(KEY);LEGACY_KEYS.forEach(key=>localStorage.removeItem(key))}

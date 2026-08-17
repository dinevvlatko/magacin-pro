import type { AppState } from '../types'
import { demoState } from './data'
import { deductOrderStock, deductStatuses, hydrateState } from './logic'
const KEY='magacin-pro-v3'
const LEGACY_KEYS=['magacin-pro-v2','magacin-pro-v1']
const PRE_SYNC_BACKUP_KEY='magacin-pro-pre-sync-backup-v1'
const SHARED_SYNC_MARKER_KEY='magacin-pro-shared-sync-v1'
export type LocalStateBackup={version:1;savedAt:string;state:AppState}
const deductPackedOrders=(state:AppState)=>state.orders.reduce((current,o)=>{if(!deductStatuses.has(o.status)||o.stockDeducted)return current;const currentOrder=current.orders.find(x=>x.id===o.id);return currentOrder?deductOrderStock(current,currentOrder)??current:current},state)
export const loadState=():AppState=>{try{const current=localStorage.getItem(KEY);if(current)return deductPackedOrders(hydrateState(JSON.parse(current) as AppState));const legacy=LEGACY_KEYS.map(key=>localStorage.getItem(key)).find(Boolean);return legacy?deductPackedOrders(hydrateState(JSON.parse(legacy) as AppState)):hydrateState(demoState())}catch{return hydrateState(demoState())}}
export const saveState=(state:AppState)=>{try{localStorage.setItem(KEY,JSON.stringify(state))}catch{/* Storage can be unavailable or full. */}}
export const loadPreSyncBackup=():LocalStateBackup|null=>{try{const value=localStorage.getItem(PRE_SYNC_BACKUP_KEY);if(!value)return null;const parsed=JSON.parse(value) as LocalStateBackup;return parsed.version===1&&parsed.state?{...parsed,state:hydrateState(parsed.state)}:null}catch{return null}}
export const preservePreSyncBackup=(local:AppState,remote:AppState):LocalStateBackup|null=>{try{if(localStorage.getItem(SHARED_SYNC_MARKER_KEY)||JSON.stringify(local)===JSON.stringify(remote))return loadPreSyncBackup();const existing=loadPreSyncBackup();if(existing)return existing;const backup:LocalStateBackup={version:1,savedAt:new Date().toISOString(),state:hydrateState(local)};localStorage.setItem(PRE_SYNC_BACKUP_KEY,JSON.stringify(backup));return backup}catch{return null}}
export const clearPreSyncBackup=()=>{try{localStorage.removeItem(PRE_SYNC_BACKUP_KEY)}catch{/* Storage can be unavailable. */}}
export const markSharedSyncReady=()=>{try{localStorage.setItem(SHARED_SYNC_MARKER_KEY,new Date().toISOString())}catch{/* Storage can be unavailable. */}}
export const clearState=()=>{localStorage.removeItem(KEY);LEGACY_KEYS.forEach(key=>localStorage.removeItem(key))}

import type { AppState } from '../types'
import { demoState } from './data'
const KEY='magacin-pro-v2'
const LEGACY_KEY='magacin-pro-v1'
const hydrate=(state:AppState):AppState=>({...state,orders:state.orders.map(o=>({...o,qty025Pieces:o.qty025Pieces||0,qty15Pieces:o.qty15Pieces||0,free025Pieces:o.free025Pieces||0}))})
export const loadState=():AppState=>{try{const raw=localStorage.getItem(KEY)||localStorage.getItem(LEGACY_KEY);return raw?hydrate(JSON.parse(raw) as AppState):demoState()}catch{return demoState()}}
export const saveState=(state:AppState)=>{try{localStorage.setItem(KEY,JSON.stringify(state))}catch{/* Storage can be unavailable or full. */}}
export const clearState=()=>{localStorage.removeItem(KEY);localStorage.removeItem(LEGACY_KEY)}

import type { AppState } from '../types'
import { demoState } from './data'
const KEY='magacin-pro-v1'
export const loadState=():AppState=>{try{const raw=localStorage.getItem(KEY);return raw?JSON.parse(raw):demoState()}catch{return demoState()}}
export const saveState=(state:AppState)=>localStorage.setItem(KEY,JSON.stringify(state))
export const clearState=()=>localStorage.removeItem(KEY)

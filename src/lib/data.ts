import type { AppState, Client, Order } from '../types'
const date='2026-07-14'
const seed=[
['Dzo Kom','Штип',80,5,2,300],['Makom Tref','Радовиш',80,10,2,400],['Tikves Tim','Кочани',35,5,2,300],['Bic Komerc','Пробиштип',50,5,2,200],['Procent','Битола',100,20,2,300],['Vo Raj','Охрид',25,5,2,400],['Alpojo','Охрид',20,5,2,400],['KG Konsalting','Струга',5,5,1,200]
] as const
export const makeOrderNumber=(orders:Order[])=>`PG-2026-${String(Math.max(0,...orders.map(o=>Number(o.number.split('-').pop())))+1).padStart(4,'0')}`
export const demoOrders:Order[]=seed.map((x,i)=>({id:crypto.randomUUID(),number:`PG-2026-${String(i+1).padStart(4,'0')}`,client:x[0],city:x[1],date,qty025:x[2],qty025Pieces:0,qty15:x[3],qty15Pieces:0,free025:x[4],free025Pieces:0,free15:0,free15Pieces:0,flyers:x[5],note:'',status:'Нова',packed:{regular025:false,bib15:false,free025:false,free15:false,flyers:false},stockDeducted:false}))
export const demoClients:Client[]=seed.map(x=>({id:crypto.randomUUID(),name:x[0],city:x[1],phone:'',contactPerson:'',address:''}))
export const demoState=():AppState=>({warehouse:{p025:{packages:150,pieces:0,total:2250,perPackage:15},p15:{packages:86,pieces:0,total:516,perPackage:6},flyers:2500},stockThresholds:{p025:300,p15:60,flyers:500},orders:demoOrders.map(o=>({...o,id:crypto.randomUUID(),packed:{...o.packed}})),clients:demoClients.map(c=>({...c,id:crypto.randomUUID()})),movements:[]})

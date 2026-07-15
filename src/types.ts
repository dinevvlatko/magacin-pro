export type OrderStatus = 'Чека залиха'|'Нова'|'Во подготовка'|'Спакувана'|'Излезена'|'Испратена'|'Доставена'|'Откажана'
export type ProductKey = 'p025'|'p15'|'flyers'
export type MovementType = 'Влез'|'Излез'|'Корекција'|'Враќање'|'Оштетување'
export interface StockUnit { packages:number; pieces:number; total:number; perPackage:number }
export interface Warehouse { p025:StockUnit; p15:StockUnit; flyers:number }
export interface PackedChecks { regular025:boolean; bib15:boolean; free025:boolean; free15?:boolean; flyers:boolean }
export interface Order { id:string; number:string; client:string; city:string; date:string; qty025:number; qty025Pieces?:number; qty15:number; qty15Pieces?:number; free025:number; free025Pieces?:number; free15?:number; free15Pieces?:number; flyers:number; note:string; status:OrderStatus; packed:PackedChecks; stockDeducted:boolean }
export interface Client { id:string; name:string; city:string; phone:string; contactPerson:string; address:string }
export interface Movement { id:string; date:string; product:ProductKey; type:MovementType; packages:number; pieces:number; party:string; orderNumber:string; note:string }
export interface StockThresholds { p025:number; p15:number; flyers:number }
export interface AppState { warehouse:Warehouse; orders:Order[]; clients:Client[]; movements:Movement[]; stockThresholds?:StockThresholds }

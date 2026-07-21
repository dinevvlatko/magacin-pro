import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { AppState } from '../types'
import { loadState, saveState } from './storage'
import { hydrateState } from './logic'
import { mergeConcurrentStates, StateMergeError } from './stateMerge'
import { supabase, syncEnabled } from './supabase'

export type SyncStatus = 'loading' | 'offline' | 'syncing' | 'synced' | 'error'
export type UserRole = 'admin' | 'operator'
export type UserProfile = {id:string;email:string;full_name:string;role:UserRole;active:boolean;created_at:string}
export type AuditDetails = Record<string,string|number|boolean|null>
type SharedWarehouseRow={id:'main';state:AppState;updated_at:string;updated_by:string|null}
type PendingSave={state:AppState;baseVersion:string}

const serialized=(state:AppState)=>JSON.stringify(state)

export function useSyncedState(){
 const initial=loadState()
 const [state,setState]=useState<AppState>(initial)
 const [session,setSession]=useState<Session|null>(null)
 const [profile,setProfile]=useState<UserProfile|null>(null)
 const [authReady,setAuthReady]=useState(false)
 const [syncReady,setSyncReady]=useState(false)
 const [syncStatus,setSyncStatus]=useState<SyncStatus>('loading')
 const [syncError,setSyncError]=useState('')
 const stateRef=useRef(initial),baseStateRef=useRef(initial),baseVersionRef=useRef(''),pendingRef=useRef<PendingSave|null>(null),saveTimerRef=useRef<number|undefined>(undefined)
 const userId=session?.user.id

 useEffect(()=>{if(!syncEnabled){setAuthReady(true);setSyncStatus('offline');return}let active=true;void supabase.auth.getSession().then(({data})=>{if(!active)return;setSession(data.session);setAuthReady(true);if(!data.session)setSyncStatus('offline')});const {data}=supabase.auth.onAuthStateChange((_event,nextSession)=>{if(!active)return;setSession(nextSession);setAuthReady(true);if(!nextSession){setProfile(null);setSyncReady(false);setSyncStatus('offline')}});return()=>{active=false;data.subscription.unsubscribe()}},[])
 useEffect(()=>{stateRef.current=state;saveState(state)},[state])

 useEffect(()=>{
  if(!userId)return
  let active=true
  setSyncReady(false);setSyncStatus('loading');setSyncError('')

  const acceptRemote=(row:SharedWarehouseRow)=>{
   const remote=hydrateState(row.state)
   if(row.updated_at===baseVersionRef.current)return
   if(pendingRef.current)return
   const current=stateRef.current,base=baseStateRef.current
   if(serialized(current)===serialized(base)){
    baseStateRef.current=remote;baseVersionRef.current=row.updated_at;stateRef.current=remote;setState(remote);setSyncStatus('synced');return
   }
   try{
    const merged=mergeConcurrentStates(base,current,remote)
    baseStateRef.current=remote;baseVersionRef.current=row.updated_at;stateRef.current=merged;setState(merged);setSyncStatus('syncing')
   }catch(error){
    baseStateRef.current=remote;baseVersionRef.current=row.updated_at;stateRef.current=remote;setState(remote);setSyncStatus('error');setSyncError(error instanceof Error?error.message:'Истовремената промена не може безбедно да се спои.')
   }
  }

  const initialize=async()=>{
   const profileRequest=supabase.from('profiles').select('id,email,full_name,role,active,created_at').eq('id',userId).single<UserProfile>()
   const stateRequest=supabase.from('shared_warehouse_state').select('id,state,updated_at,updated_by').eq('id','main').maybeSingle<SharedWarehouseRow>()
   const [{data:profileData,error:profileError},{data,error}]=await Promise.all([profileRequest,stateRequest])
   if(!active)return
   if(profileError||!profileData){setSyncStatus('error');setSyncError(profileError?.message||'Корисничкиот профил не е пронајден.');return}
   setProfile(profileData)
   if(!profileData.active){setSyncStatus('error');setSyncError('Овој кориснички профил е деактивиран.');return}
   if(error){setSyncStatus('error');setSyncError(error.message);return}
   if(data){const remote=hydrateState(data.state);baseStateRef.current=remote;baseVersionRef.current=data.updated_at;stateRef.current=remote;setState(remote);saveState(remote)}
   else{
    const local=hydrateState(loadState()),updatedAt=new Date().toISOString()
    const {data:created,error:insertError}=await supabase.from('shared_warehouse_state').insert({id:'main',state:local,updated_at:updatedAt,updated_by:userId}).select('id,state,updated_at,updated_by').maybeSingle<SharedWarehouseRow>()
    if(insertError?.code==='23505'){const {data:existing,error:existingError}=await supabase.from('shared_warehouse_state').select('id,state,updated_at,updated_by').eq('id','main').single<SharedWarehouseRow>();if(existingError||!existing){setSyncStatus('error');setSyncError(existingError?.message||'Не може да се вчита заедничкиот магацин.');return}const remote=hydrateState(existing.state);baseStateRef.current=remote;baseVersionRef.current=existing.updated_at;stateRef.current=remote;setState(remote);saveState(remote)}
    else if(insertError||!created){setSyncStatus('error');setSyncError(insertError?.message||'Не може да се креира заедничкиот магацин.');return}
    else{baseStateRef.current=local;baseVersionRef.current=created.updated_at;stateRef.current=local;setState(local)}
   }
   setSyncReady(true);setSyncStatus('synced')
  }

  void initialize()
  const channel=supabase.channel('shared-warehouse-main').on('postgres_changes',{event:'UPDATE',schema:'public',table:'shared_warehouse_state',filter:'id=eq.main'},payload=>{if(active)acceptRemote(payload.new as SharedWarehouseRow)}).subscribe()
  return()=>{active=false;pendingRef.current=null;if(saveTimerRef.current)window.clearTimeout(saveTimerRef.current);void supabase.removeChannel(channel)}
 },[userId])

 useEffect(()=>{
  if(!session||!syncReady)return
  if(serialized(state)===serialized(baseStateRef.current))return
  if(saveTimerRef.current)window.clearTimeout(saveTimerRef.current)

  const persist=async(candidate:AppState,attempt=0):Promise<void>=>{
   if(attempt>3){setSyncStatus('error');setSyncError('Промените се случуваат истовремено на повеќе локации. Освежи и повтори ја последната операција.');return}
   const base=baseStateRef.current,baseVersion=baseVersionRef.current,updatedAt=new Date().toISOString()
   pendingRef.current={state:candidate,baseVersion};setSyncStatus('syncing')
   const {data,error}=await supabase.from('shared_warehouse_state').update({state:candidate,updated_at:updatedAt,updated_by:session.user.id}).eq('id','main').eq('updated_at',baseVersion).select('id,state,updated_at,updated_by').maybeSingle<SharedWarehouseRow>()
   if(error){pendingRef.current=null;setSyncStatus('error');setSyncError(error.message);return}
   if(data){pendingRef.current=null;baseStateRef.current=candidate;baseVersionRef.current=data.updated_at;const latest=stateRef.current;if(serialized(latest)===serialized(candidate)){setSyncStatus('synced');setSyncError('')}else await persist(latest,attempt);return}

   const {data:latestRow,error:fetchError}=await supabase.from('shared_warehouse_state').select('id,state,updated_at,updated_by').eq('id','main').single<SharedWarehouseRow>()
   pendingRef.current=null
   if(fetchError||!latestRow){setSyncStatus('error');setSyncError(fetchError?.message||'Не може да се провери истовремената промена.');return}
   const remote=hydrateState(latestRow.state)
   try{
    let merged=mergeConcurrentStates(base,candidate,remote)
    const current=stateRef.current
    if(serialized(current)!==serialized(candidate))merged=mergeConcurrentStates(candidate,current,merged)
    baseStateRef.current=remote;baseVersionRef.current=latestRow.updated_at;stateRef.current=merged;setState(merged);await persist(merged,attempt+1)
   }catch(mergeError){
    baseStateRef.current=remote;baseVersionRef.current=latestRow.updated_at;stateRef.current=remote;setState(remote);setSyncStatus('error');setSyncError(mergeError instanceof StateMergeError?mergeError.message:'Истовремената промена не е зачувана. Провери ја новата состојба.')
   }
  }

  saveTimerRef.current=window.setTimeout(()=>void persist(state),350)
  return()=>{if(saveTimerRef.current)window.clearTimeout(saveTimerRef.current)}
 },[session,state,syncReady])

 const recordAudit=useCallback(async(action:string,entityType:string,entityId:string|null,details:AuditDetails={})=>{if(!userId)return;const {error}=await supabase.from('activity_log').insert({actor_id:userId,action,entity_type:entityType,entity_id:entityId,details});if(error){setSyncStatus('error');setSyncError(`Промената е зачувана, но активноста не е запишана: ${error.message}`)}},[userId])
 return {state,setState,session,profile,authReady,syncStatus,syncError,recordAudit}
}

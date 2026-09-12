import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { AppState } from '../types'
import { clearPreSyncBackup, loadPreSyncBackup, loadState, markSharedSyncReady, preservePreSyncBackup, saveState, type LocalStateBackup } from './storage'
import { hydrateState } from './logic'
import { mergeConcurrentStates, StateMergeError } from './stateMerge'
import { mergeIndependentStates } from './stateImport'
import { supabase, syncEnabled } from './supabase'
import { blockedAccessMessage, profileAccess, type ProfileAccess } from './accessControl'

export type SyncStatus = 'loading' | 'offline' | 'syncing' | 'synced' | 'error'
export type UserRole = 'admin' | 'operator'
export type UserProfile = {id:string;email:string;full_name:string;role:UserRole;active:boolean;created_at:string}
export type AuditDetails = Record<string,string|number|boolean|null>
type SharedWarehouseRow={id:'main';state:AppState;updated_at:string;updated_by:string|null}
type PendingSave={state:AppState;baseVersion:string}

const serialized=(state:AppState)=>JSON.stringify(state)
const persistedBase=(stored:AppState,hydrated:AppState)=>serialized(stored)===serialized(hydrated)?hydrated:stored

export function useSyncedState(){
 const initial=loadState()
 const [state,setState]=useState<AppState>(initial)
 const [session,setSession]=useState<Session|null>(null)
 const [profile,setProfile]=useState<UserProfile|null>(null)
 const [access,setAccess]=useState<ProfileAccess>(syncEnabled?'checking':'allowed')
 const [authReady,setAuthReady]=useState(false)
 const [syncReady,setSyncReady]=useState(false)
 const [syncStatus,setSyncStatus]=useState<SyncStatus>('loading')
 const [syncError,setSyncError]=useState('')
 const [localBackup,setLocalBackup]=useState<LocalStateBackup|null>(()=>loadPreSyncBackup())
 const stateRef=useRef(initial),baseStateRef=useRef(initial),baseVersionRef=useRef(''),pendingRef=useRef<PendingSave|null>(null),saveTimerRef=useRef<number|undefined>(undefined)
 const userId=session?.user.id

 useEffect(()=>{if(!syncEnabled){setAccess('allowed');setAuthReady(true);setSyncStatus('offline');return}let active=true;const applySession=(nextSession:Session|null)=>{if(!active)return;setSession(nextSession);setAuthReady(true);if(nextSession){setAccess('checking');return}setProfile(null);setSyncReady(false);setSyncStatus('offline')};void supabase.auth.getSession().then(({data})=>applySession(data.session));const {data}=supabase.auth.onAuthStateChange((_event,nextSession)=>applySession(nextSession));return()=>{active=false;data.subscription.unsubscribe()}},[])
 useEffect(()=>{stateRef.current=state;saveState(state)},[state])

 useEffect(()=>{
  if(!userId)return
  let active=true
  setSyncReady(false);setSyncStatus('loading');setSyncError('')

  const acceptRemote=(row:SharedWarehouseRow)=>{
   const remote=hydrateState(row.state)
   const remoteBase=persistedBase(row.state,remote)
   if(row.updated_at===baseVersionRef.current)return
   if(pendingRef.current)return
   const current=stateRef.current,base=baseStateRef.current
   if(serialized(current)===serialized(base)){
    baseStateRef.current=remoteBase;baseVersionRef.current=row.updated_at;stateRef.current=remote;setState(remote);setSyncStatus(serialized(remoteBase)===serialized(remote)?'synced':'syncing');return
   }
   try{
    const merged=mergeConcurrentStates(base,current,remote)
    baseStateRef.current=remoteBase;baseVersionRef.current=row.updated_at;stateRef.current=merged;setState(merged);setSyncStatus('syncing')
   }catch(error){
    baseStateRef.current=remoteBase;baseVersionRef.current=row.updated_at;stateRef.current=remote;setState(remote);setSyncStatus('error');setSyncError(error instanceof Error?error.message:'Истовремената промена не може безбедно да се спои.')
   }
  }
  const adoptInitialRemote=(row:SharedWarehouseRow)=>{
   const remote=hydrateState(row.state)
   const backup=preservePreSyncBackup(hydrateState(stateRef.current),remote)
   if(backup)setLocalBackup(backup)
   baseStateRef.current=persistedBase(row.state,remote);baseVersionRef.current=row.updated_at;stateRef.current=remote;setState(remote);saveState(remote);markSharedSyncReady()
  }

  const denyAccess=()=>{setProfile(null);setAccess('blocked');setSyncReady(false);setSyncStatus('error');setSyncError(blockedAccessMessage);pendingRef.current=null;if(saveTimerRef.current)window.clearTimeout(saveTimerRef.current);void supabase.auth.signOut()}
  const acceptProfile=(nextProfile:UserProfile)=>{
   if(!nextProfile.active){denyAccess();return false}
   setProfile(nextProfile);setAccess(profileAccess(nextProfile));return true
  }
  const initialize=async()=>{
   const profileRequest=supabase.from('profiles').select('id,email,full_name,role,active,created_at').eq('id',userId).single<UserProfile>()
   const stateRequest=supabase.from('shared_warehouse_state').select('id,state,updated_at,updated_by').eq('id','main').maybeSingle<SharedWarehouseRow>()
   const [{data:profileData,error:profileError},{data,error}]=await Promise.all([profileRequest,stateRequest])
   if(!active)return
   if(profileError||!profileData){setSyncStatus('error');setSyncError(profileError?.message||'Корисничкиот профил не е пронајден.');return}
   if(!acceptProfile(profileData))return
   if(error){setSyncStatus('error');setSyncError(error.message);return}
   if(data)adoptInitialRemote(data)
   else{
    const local=hydrateState(loadState()),updatedAt=new Date().toISOString()
    const {data:created,error:insertError}=await supabase.from('shared_warehouse_state').insert({id:'main',state:local,updated_at:updatedAt,updated_by:userId}).select('id,state,updated_at,updated_by').maybeSingle<SharedWarehouseRow>()
    if(insertError?.code==='23505'){const {data:existing,error:existingError}=await supabase.from('shared_warehouse_state').select('id,state,updated_at,updated_by').eq('id','main').single<SharedWarehouseRow>();if(existingError||!existing){setSyncStatus('error');setSyncError(existingError?.message||'Не може да се вчита заедничкиот магацин.');return}adoptInitialRemote(existing)}
    else if(insertError||!created){setSyncStatus('error');setSyncError(insertError?.message||'Не може да се креира заедничкиот магацин.');return}
    else{baseStateRef.current=local;baseVersionRef.current=created.updated_at;stateRef.current=local;setState(local);markSharedSyncReady()}
   }
   setSyncReady(true);setSyncStatus('synced')
  }

  void initialize()
  const warehouseChannel=supabase.channel('shared-warehouse-main').on('postgres_changes',{event:'UPDATE',schema:'public',table:'shared_warehouse_state',filter:'id=eq.main'},payload=>{if(active)acceptRemote(payload.new as SharedWarehouseRow)}).subscribe()
  const profileChannel=supabase.channel(`profile-access-${userId}`).on('postgres_changes',{event:'UPDATE',schema:'public',table:'profiles',filter:`id=eq.${userId}`},payload=>{if(active)acceptProfile(payload.new as UserProfile)}).subscribe()
  return()=>{active=false;pendingRef.current=null;if(saveTimerRef.current)window.clearTimeout(saveTimerRef.current);void supabase.removeChannel(warehouseChannel);void supabase.removeChannel(profileChannel)}
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
   if(serialized(candidate)===serialized(remote)){
    baseStateRef.current=remote;baseVersionRef.current=latestRow.updated_at
    const current=stateRef.current
    if(serialized(current)===serialized(candidate)){setSyncStatus('synced');setSyncError('');return}
    await persist(current,attempt+1);return
   }
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

 const reconcileLocalBackup=useCallback(async(mode:'merge'|'replace'|'discard')=>{
  if(mode==='discard'){clearPreSyncBackup();setLocalBackup(null);markSharedSyncReady();return true}
  if(!session||!localBackup||!syncReady||syncStatus!=='synced'){setSyncError('Почекај прво да заврши тековната синхронизација.');return false}
  if(mode==='replace'&&profile?.role!=='admin'){setSyncError('Само администратор може да ја постави локалната верзија како главна.');return false}
  if(saveTimerRef.current)window.clearTimeout(saveTimerRef.current)
  pendingRef.current={state:stateRef.current,baseVersion:baseVersionRef.current};setSyncStatus('syncing');setSyncError('')
  for(let attempt=0;attempt<4;attempt+=1){
   const {data:latest,error:fetchError}=await supabase.from('shared_warehouse_state').select('id,state,updated_at,updated_by').eq('id','main').single<SharedWarehouseRow>()
   if(fetchError||!latest){pendingRef.current=null;setSyncStatus('error');setSyncError(fetchError?.message||'Не може да се вчита последната заедничка верзија.');return false}
   const remote=hydrateState(latest.state)
   const candidate=mode==='replace'?hydrateState(localBackup.state):mergeIndependentStates(remote,localBackup.state)
   const updatedAt=new Date().toISOString()
   const {data:updated,error:updateError}=await supabase.from('shared_warehouse_state').update({state:candidate,updated_at:updatedAt,updated_by:session.user.id}).eq('id','main').eq('updated_at',latest.updated_at).select('id,state,updated_at,updated_by').maybeSingle<SharedWarehouseRow>()
   if(updateError){pendingRef.current=null;setSyncStatus('error');setSyncError(updateError.message);return false}
   if(!updated)continue
   pendingRef.current=null;baseStateRef.current=candidate;baseVersionRef.current=updated.updated_at;stateRef.current=candidate;setState(candidate);saveState(candidate);clearPreSyncBackup();setLocalBackup(null);markSharedSyncReady();setSyncStatus('synced');setSyncError('')
   void supabase.from('activity_log').insert({actor_id:session.user.id,action:mode==='replace'?'app.local_state_replaced':'app.local_state_merged',entity_type:'app',entity_id:null,details:{backup_saved_at:localBackup.savedAt}})
   return true
  }
  pendingRef.current=null;setSyncStatus('error');setSyncError('Во меѓувреме има друга промена. Почекај неколку секунди и обиди се повторно.');return false
 },[localBackup,profile?.role,session,syncReady,syncStatus])

 const recordAudit=useCallback(async(action:string,entityType:string,entityId:string|null,details:AuditDetails={})=>{if(!userId)return;const {error}=await supabase.from('activity_log').insert({actor_id:userId,action,entity_type:entityType,entity_id:entityId,details});if(error){setSyncStatus('error');setSyncError(`Промената е зачувана, но активноста не е запишана: ${error.message}`)}},[userId])
 return {state,setState,session,profile,access,authReady,syncStatus,syncError,localBackup,reconcileLocalBackup,recordAudit}
}

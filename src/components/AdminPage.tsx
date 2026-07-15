import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, ShieldCheck, UserCheck, UserX } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { UserProfile, UserRole } from '../lib/useSyncedState'
import { Card, Empty, PageHeader } from './UI'

type ActivityRow = {
  id: number
  actor_id: string
  action: string
  entity_type: string
  entity_id: string | null
  details: Record<string, unknown>
  created_at: string
}

const actionLabels:Record<string,string>={
  'order.created':'Креирана нарачка',
  'order.deleted':'Избришана нарачка',
  'order.status_changed':'Променет статус',
  'order.packing_checked':'Променета ставка за пакување',
  'stock.movement':'Движење на залиха',
  'stock.receipt':'Креирана приемница',
  'app.demo_reset':'Ресетирани демо податоци',
  'user.role_changed':'Променета корисничка улога',
  'user.access_changed':'Променет кориснички пристап',
}

export function AdminPage({currentUserId}:{currentUserId:string}){
  const [profiles,setProfiles]=useState<UserProfile[]>([])
  const [activity,setActivity]=useState<ActivityRow[]>([])
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')

  const load=useCallback(async()=>{
    setLoading(true);setError('')
    const [profilesResult,activityResult]=await Promise.all([
      supabase.from('profiles').select('id,email,full_name,role,active,created_at').order('created_at',{ascending:true}),
      supabase.from('activity_log').select('id,actor_id,action,entity_type,entity_id,details,created_at').order('created_at',{ascending:false}).limit(200),
    ])
    if(profilesResult.error||activityResult.error){setError(profilesResult.error?.message||activityResult.error?.message||'Не може да се вчита администрацијата.');setLoading(false);return}
    setProfiles((profilesResult.data||[]) as UserProfile[])
    setActivity((activityResult.data||[]) as ActivityRow[])
    setLoading(false)
  },[])

  useEffect(()=>{void load()},[load])

  const profileMap=useMemo(()=>new Map(profiles.map(profile=>[profile.id,profile])),[profiles])
  const updateProfile=async(id:string,patch:{role?:UserRole;active?:boolean})=>{
    const current=profiles.find(profile=>profile.id===id)
    if(!current)return
    const {error:updateError}=await supabase.from('profiles').update(patch).eq('id',id)
    if(updateError){setError(updateError.message);return}
    const action=patch.role?'user.role_changed':'user.access_changed'
    const details=patch.role?{email:current.email,from:current.role,to:patch.role}:{email:current.email,from:current.active,to:patch.active??current.active}
    const {error:auditError}=await supabase.from('activity_log').insert({actor_id:currentUserId,action,entity_type:'user',entity_id:id,details})
    if(auditError){setError(`Промената е зачувана, но активноста не е запишана: ${auditError.message}`)}
    await load()
  }

  return <><PageHeader title="Администрација" action={<button className="ghost" onClick={()=>void load()}><RefreshCw size={17}/> Освежи</button>}/>{error&&<div className="admin-error">{error}</div>}<div className="admin-grid"><Card><div className="section-title"><div><h3>Корисници</h3><p>Улоги и пристап до заедничкиот магацин</p></div><span className="admin-count">{profiles.length}</span></div>{loading?<p className="muted">Се вчитува...</p>:profiles.length===0?<Empty text="Нема регистрирани корисници."/>:<div className="admin-users">{profiles.map(profile=><div className="admin-user" key={profile.id}><div className="avatar">{(profile.full_name||profile.email).slice(0,2).toUpperCase()}</div><div><strong>{profile.full_name||'Без внесено име'}</strong><small>{profile.email}</small></div><select value={profile.role} disabled={profile.id===currentUserId} onChange={e=>void updateProfile(profile.id,{role:e.target.value as UserRole})}><option value="operator">Оператор</option><option value="admin">Админ</option></select><button className={profile.active?'user-active':'user-inactive'} disabled={profile.id===currentUserId} onClick={()=>void updateProfile(profile.id,{active:!profile.active})}>{profile.active?<><UserCheck size={16}/> Активен</>:<><UserX size={16}/> Исклучен</>}</button></div>)}</div>}</Card><Card><div className="section-title"><div><h3>Активност</h3><p>Последни 200 промени во системот</p></div><ShieldCheck size={22}/></div>{loading?<p className="muted">Се вчитува...</p>:activity.length===0?<Empty text="Сè уште нема запишани активности."/>:<div className="activity-list">{activity.map(item=>{const actor=profileMap.get(item.actor_id);return <article key={item.id}><div><strong>{actionLabels[item.action]||item.action}</strong><span>{actor?.full_name||actor?.email||'Непознат корисник'} • {new Date(item.created_at).toLocaleString('mk-MK')}</span></div><p>{item.entity_id||item.entity_type}{Object.keys(item.details||{}).length>0?` • ${Object.entries(item.details).map(([key,value])=>`${key}: ${String(value)}`).join(', ')}`:''}</p></article>})}</div>}</Card></div></>
}

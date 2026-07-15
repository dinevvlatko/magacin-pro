import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { AppState } from '../types'
import { loadState, saveState } from './storage'
import { hydrateState } from './logic'
import { supabase, syncEnabled } from './supabase'

export type SyncStatus = 'loading' | 'offline' | 'syncing' | 'synced' | 'error'
export type UserRole = 'admin' | 'operator'
export type UserProfile = {
  id: string
  email: string
  full_name: string
  role: UserRole
  active: boolean
  created_at: string
}
export type AuditDetails = Record<string, string | number | boolean | null>

type SharedWarehouseRow = {
  id: 'main'
  state: AppState
  updated_at: string
  updated_by: string | null
}

export function useSyncedState() {
  const [state, setState] = useState<AppState>(loadState)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [syncReady, setSyncReady] = useState(false)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('loading')
  const [syncError, setSyncError] = useState('')
  const lastRemoteState = useRef('')
  const userId = session?.user.id

  useEffect(() => {
    if (!syncEnabled) {
      setAuthReady(true)
      setSyncStatus('offline')
      return
    }
    let active = true
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setAuthReady(true)
      if (!data.session) setSyncStatus('offline')
    })
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return
      setSession(nextSession)
      setAuthReady(true)
      if (!nextSession) {
        setProfile(null)
        setSyncReady(false)
        setSyncStatus('offline')
      }
    })
    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    saveState(state)
  }, [state])

  useEffect(() => {
    if (!userId) return
    let active = true
    setSyncReady(false)
    setSyncStatus('loading')
    setSyncError('')

    const initialize = async () => {
      const profileRequest = supabase
        .from('profiles')
        .select('id,email,full_name,role,active,created_at')
        .eq('id', userId)
        .single<UserProfile>()
      const stateRequest = supabase
        .from('shared_warehouse_state')
        .select('id,state,updated_at,updated_by')
        .eq('id', 'main')
        .maybeSingle<SharedWarehouseRow>()
      const [{ data: profileData, error: profileError }, { data, error }] = await Promise.all([profileRequest, stateRequest])

      if (!active) return
      if (profileError || !profileData) {
        setSyncStatus('error')
        setSyncError(profileError?.message || 'Корисничкиот профил не е пронајден.')
        return
      }
      setProfile(profileData)
      if (!profileData.active) {
        setSyncStatus('error')
        setSyncError('Овој кориснички профил е деактивиран.')
        return
      }
      if (error) {
        setSyncStatus('error')
        setSyncError(error.message)
        return
      }

      if (data?.state) {
        const serialized = JSON.stringify(data.state)
        const hydrated = hydrateState(data.state)
        lastRemoteState.current = serialized
        setState(hydrated)
        saveState(hydrated)
      } else {
        const localState = loadState()
        const { error: insertError } = await supabase.from('shared_warehouse_state').insert({
          id: 'main',
          state: localState,
          updated_by: userId,
        })
        if (!active) return
        if (insertError?.code === '23505') {
          const { data: existing, error: existingError } = await supabase
            .from('shared_warehouse_state')
            .select('state')
            .eq('id', 'main')
            .single<{ state: AppState }>()
          if (existingError || !existing) {
            setSyncStatus('error')
            setSyncError(existingError?.message || 'Не може да се вчита заедничкиот магацин.')
            return
          }
          lastRemoteState.current = JSON.stringify(existing.state)
          const hydrated = hydrateState(existing.state)
          setState(hydrated)
          saveState(hydrated)
        } else if (insertError) {
          setSyncStatus('error')
          setSyncError(insertError.message)
          return
        } else {
          lastRemoteState.current = JSON.stringify(localState)
        }
      }

      setSyncReady(true)
      setSyncStatus('synced')
    }

    void initialize()

    const channel = supabase
      .channel('shared-warehouse-main')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'shared_warehouse_state',
          filter: 'id=eq.main',
        },
        payload => {
          if (!active) return
          const remote = (payload.new as SharedWarehouseRow).state
          if (!remote) return
          const serialized = JSON.stringify(remote)
          if (serialized === lastRemoteState.current) return
          const hydrated = hydrateState(remote)
          lastRemoteState.current = serialized
          setState(hydrated)
          saveState(hydrated)
          setSyncStatus('synced')
        },
      )
      .subscribe()

    return () => {
      active = false
      void supabase.removeChannel(channel)
    }
  }, [userId])

  useEffect(() => {
    if (!session || !syncReady) return
    const serialized = JSON.stringify(state)
    if (serialized === lastRemoteState.current) return

    setSyncStatus('syncing')
    const timeout = window.setTimeout(async () => {
      const { error } = await supabase
        .from('shared_warehouse_state')
        .update({ state, updated_at: new Date().toISOString(), updated_by: session.user.id })
        .eq('id', 'main')

      if (error) {
        setSyncStatus('error')
        setSyncError(error.message)
        return
      }
      lastRemoteState.current = serialized
      setSyncStatus('synced')
      setSyncError('')
    }, 350)

    return () => window.clearTimeout(timeout)
  }, [session, state, syncReady])

  const recordAudit = useCallback(async (action: string, entityType: string, entityId: string | null, details: AuditDetails = {}) => {
    if (!userId) return
    const { error } = await supabase.from('activity_log').insert({
      actor_id: userId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      details,
    })
    if (error) {
      setSyncStatus('error')
      setSyncError(`Промената е зачувана, но активноста не е запишана: ${error.message}`)
    }
  }, [userId])

  return {
    state,
    setState,
    session,
    profile,
    authReady,
    syncStatus,
    syncError,
    recordAudit,
  }
}

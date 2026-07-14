import { useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { AppState } from '../types'
import { loadState, saveState } from './storage'
import { supabase, syncEnabled } from './supabase'

export type SyncStatus = 'loading' | 'offline' | 'syncing' | 'synced' | 'error'

type WarehouseRow = {
  owner_id: string
  state: AppState
  updated_at: string
}

export function useSyncedState() {
  const [state, setState] = useState<AppState>(loadState)
  const [session, setSession] = useState<Session | null>(null)
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
      const { data, error } = await supabase
        .from('warehouse_state')
        .select('owner_id,state,updated_at')
        .eq('owner_id', userId)
        .maybeSingle<WarehouseRow>()

      if (!active) return
      if (error) {
        setSyncStatus('error')
        setSyncError(error.message)
        return
      }

      if (data?.state) {
        const serialized = JSON.stringify(data.state)
        lastRemoteState.current = serialized
        setState(data.state)
        saveState(data.state)
      } else {
        const localState = loadState()
        const { error: insertError } = await supabase.from('warehouse_state').insert({
          owner_id: userId,
          state: localState,
        })
        if (!active) return
        if (insertError) {
          setSyncStatus('error')
          setSyncError(insertError.message)
          return
        }
        lastRemoteState.current = JSON.stringify(localState)
      }

      setSyncReady(true)
      setSyncStatus('synced')
    }

    void initialize()

    const channel = supabase
      .channel(`warehouse-state-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'warehouse_state',
          filter: `owner_id=eq.${userId}`,
        },
        payload => {
          if (!active) return
          const remote = (payload.new as WarehouseRow).state
          if (!remote) return
          const serialized = JSON.stringify(remote)
          if (serialized === lastRemoteState.current) return
          lastRemoteState.current = serialized
          setState(remote)
          saveState(remote)
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
        .from('warehouse_state')
        .update({ state, updated_at: new Date().toISOString() })
        .eq('owner_id', session.user.id)

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

  return {
    state,
    setState,
    session,
    authReady,
    syncStatus,
    syncError,
  }
}

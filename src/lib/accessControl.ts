export type ProfileAccess = 'checking' | 'allowed' | 'blocked'

export const blockedAccessMessage = 'Пристапот до апликацијата е блокиран. Контактирај го администраторот.'

export const profileAccess = (profile: { active: boolean } | null | undefined): ProfileAccess => {
  if (!profile) return 'checking'
  return profile.active ? 'allowed' : 'blocked'
}

export const accessAction = (active: boolean) => active ? 'Блокирај' : 'Одблокирај'

import { describe, expect, it } from 'vitest'
import { accessAction, blockedAccessMessage, profileAccess } from './accessControl'

describe('profile access control', () => {
  it('waits for the profile before allowing the application to render', () => {
    expect(profileAccess(null)).toBe('checking')
  })

  it('allows only active profiles', () => {
    expect(profileAccess({ active: true })).toBe('allowed')
    expect(profileAccess({ active: false })).toBe('blocked')
  })

  it('uses clear Macedonian actions and a blocked-access message', () => {
    expect(accessAction(true)).toBe('Блокирај')
    expect(accessAction(false)).toBe('Одблокирај')
    expect(blockedAccessMessage).toContain('блокиран')
  })
})

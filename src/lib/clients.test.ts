import { describe, expect, it } from 'vitest'
import type { Client } from '../types'
import { clientAddressLine, findClientByName, sanitizeClient } from './clients'

const client: Client = {
  id: 'client-1',
  name: '  Тест Фирма  ',
  city: ' Скопје ',
  phone: ' 070 000 000 ',
  contactPerson: ' Ана ',
  address: ' Ул. Македонија 1 ',
  taxNumber: ' MK123 ',
  companyNumber: ' 1234567 ',
  bankAccount: ' 000-000 ',
  email: ' info@example.com ',
  cargoInfo: ' Карго центар 2 ',
  note: ' Позвони пред достава ',
}

describe('client dossiers', () => {
  it('sanitizes all editable profile fields before saving', () => {
    expect(sanitizeClient(client)).toMatchObject({
      name: 'Тест Фирма',
      city: 'Скопје',
      contactPerson: 'Ана',
      address: 'Ул. Македонија 1',
      companyNumber: '1234567',
      cargoInfo: 'Карго центар 2',
    })
  })

  it('finds a client using a case-insensitive normalized company name', () => {
    expect(findClientByName([sanitizeClient(client)], 'тест фирма')?.id).toBe('client-1')
  })

  it('formats the delivery address without empty separators', () => {
    expect(clientAddressLine(sanitizeClient(client))).toBe('Ул. Македонија 1, Скопје')
    expect(clientAddressLine({ ...sanitizeClient(client), address: '' })).toBe('Скопје')
  })
})

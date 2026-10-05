import type { Client } from '../types'

export const normalizeClientName = (value: string) => value.trim().toLocaleLowerCase('mk-MK')

const clientTextFields: (keyof Omit<Client, 'id'>)[] = [
  'name',
  'city',
  'phone',
  'contactPerson',
  'address',
  'taxNumber',
  'companyNumber',
  'bankAccount',
  'email',
  'cargoInfo',
  'note',
]

export const sanitizeClient = (client: Client): Client => {
  const sanitized = { ...client }
  clientTextFields.forEach(field => {
    sanitized[field] = (client[field] || '').trim()
  })
  return sanitized
}

export const findClientByName = (clients: Client[] | undefined, name: string): Client | undefined => {
  const normalized = normalizeClientName(name)
  return clients?.find(client => normalizeClientName(client.name) === normalized)
}

export const clientAddressLine = (client: Client): string =>
  [client.address, client.city].map(value => value.trim()).filter(Boolean).join(', ')


import { supabase } from './supabase'

export interface ProductRecord {
  id: string
  code: string
  name: string
  package_size: number
  stock_units: number
  active: boolean
}

export interface ReceiptItemDraft {
  id: string
  productId: string
  packages: number
  extraPieces: number
}

export interface ReceiptItemRecord {
  id: string
  product_id: string
  packages: number
  extra_pieces: number
  total_units: number
  product: ProductRecord
}

export interface ReceiptRecord {
  id: string
  number: string
  receipt_date: string
  workers_team: string
  note: string
  created_at: string
  updated_at: string
  receipt_items: ReceiptItemRecord[]
}

export interface ReceiptInput {
  receiptDate: string
  workersTeam: string
  note: string
  items: ReceiptItemDraft[]
}

export class ReceiptValidationError extends Error {}
export class ReceiptSchemaMissingError extends Error {}

const productMap = (products: ProductRecord[]) => new Map(products.map(product => [product.id, product]))

export const receiptItemUnits = (item: Pick<ReceiptItemDraft, 'packages' | 'extraPieces'>, packageSize: number) =>
  item.packages * packageSize + item.extraPieces

export const validateReceiptItems = (items: ReceiptItemDraft[], products: ProductRecord[]) => {
  if (!items.length) throw new ReceiptValidationError('Приемницата мора да има најмалку една ставка.')
  const byId = productMap(products)
  const seen = new Set<string>()
  let hasQuantity = false
  for (const item of items) {
    if (seen.has(item.productId)) throw new ReceiptValidationError('Истиот производ не може да биде внесен двапати.')
    seen.add(item.productId)
    const product = byId.get(item.productId)
    if (!product || !product.active) throw new ReceiptValidationError('Избраниот производ не е достапен.')
    if (!Number.isInteger(item.packages) || item.packages < 0 || !Number.isInteger(item.extraPieces) || item.extraPieces < 0) {
      throw new ReceiptValidationError('Количините мора да бидат цели позитивни броеви.')
    }
    if (product.package_size > 1 && item.extraPieces >= product.package_size) {
      throw new ReceiptValidationError(`Дополнителните парчиња за ${product.name} мора да бидат помалку од ${product.package_size}.`)
    }
    if (receiptItemUnits(item, product.package_size) > 0) hasQuantity = true
  }
  if (!hasQuantity) throw new ReceiptValidationError('Најмалку една ставка мора да има количина поголема од нула.')
  return items
}

export const receiptItemDeltas = (
  previous: Array<Pick<ReceiptItemDraft, 'productId' | 'packages' | 'extraPieces'>>,
  next: Array<Pick<ReceiptItemDraft, 'productId' | 'packages' | 'extraPieces'>>,
  products: ProductRecord[],
) => {
  const byId = productMap(products)
  const totals = new Map<string, number>()
  const add = (items: typeof previous, direction: 1 | -1) => items.forEach(item => {
    const product = byId.get(item.productId)
    if (!product) throw new ReceiptValidationError('Производот од приемницата не постои.')
    totals.set(item.productId, (totals.get(item.productId) || 0) + direction * receiptItemUnits(item, product.package_size))
  })
  add(previous, -1)
  add(next, 1)
  return Object.fromEntries([...totals].filter(([, delta]) => delta !== 0))
}

export const applyWarehouseDeltasAtomically = (stock: Record<string, number>, deltas: Record<string, number>) => {
  const next = { ...stock }
  for (const [productId, delta] of Object.entries(deltas)) {
    const value = (next[productId] || 0) + delta
    if (value < 0) throw new ReceiptValidationError('Измената би создала негативна залиха.')
    next[productId] = value
  }
  return next
}

const rpcItems = (items: ReceiptItemDraft[]) => items.map(item => ({
  product_id: item.productId,
  packages: item.packages,
  extra_pieces: item.extraPieces,
}))

const schemaMissing = (message: string) =>
  /schema cache|Could not find the table|function .* does not exist/i.test(message)

export const loadReceiptModule = async () => {
  const [productsResult, receiptsResult] = await Promise.all([
    supabase.from('products').select('id,code,name,package_size,stock_units,active').eq('active', true).order('name'),
    supabase.from('receipts').select('id,number,receipt_date,workers_team,note,created_at,updated_at,receipt_items(id,product_id,packages,extra_pieces,total_units,product:products(id,code,name,package_size,stock_units,active))').order('receipt_date', { ascending: false }).order('number', { ascending: false }),
  ])
  const error = productsResult.error || receiptsResult.error
  if (error) {
    if (schemaMissing(error.message)) throw new ReceiptSchemaMissingError('Недостига Phase 1 migration: products, receipts и receipt_items.')
    throw error
  }
  return {
    products: (productsResult.data || []) as ProductRecord[],
    receipts: (receiptsResult.data || []) as unknown as ReceiptRecord[],
  }
}

export const createReceiptAtomic = async (input: ReceiptInput, products: ProductRecord[]) => {
  validateReceiptItems(input.items, products)
  const { data, error } = await supabase.rpc('create_receipt_atomic', {
    p_receipt_date: input.receiptDate,
    p_workers_team: input.workersTeam,
    p_note: input.note,
    p_items: rpcItems(input.items),
  })
  if (error) {
    if (schemaMissing(error.message)) throw new ReceiptSchemaMissingError('Недостига Phase 1 migration или atomic receipt функцијата.')
    throw error
  }
  return data as { id: string; number: string }
}

export const updateReceiptAtomic = async (receiptId: string, input: ReceiptInput, products: ProductRecord[]) => {
  validateReceiptItems(input.items, products)
  const { data, error } = await supabase.rpc('update_receipt_atomic', {
    p_receipt_id: receiptId,
    p_receipt_date: input.receiptDate,
    p_workers_team: input.workersTeam,
    p_note: input.note,
    p_items: rpcItems(input.items),
  })
  if (error) {
    if (schemaMissing(error.message)) throw new ReceiptSchemaMissingError('Недостига Phase 1 migration или atomic receipt функцијата.')
    throw error
  }
  return data as { id: string; number: string }
}

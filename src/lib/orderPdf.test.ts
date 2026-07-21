import { readFile } from 'node:fs/promises'
import { afterEach,describe,expect,it,vi } from 'vitest'
import type { Order } from '../types'
import { createOrderPdf,packingCalculation } from './orderPdf'

const sample:Order={id:'one',number:'PG-2026-0001',client:'Тест Клиент',city:'Скопје',date:'2026-07-15',qty025:10,qty025Pieces:2,qty15:5,qty15Pieces:1,free025:1,free025Pieces:0,free15:2,free15Pieces:1,flyers:200,note:'Македонски текст',status:'Нова',packed:{regular025:false,bib15:false,free025:false,free15:false,flyers:false},stockDeducted:false}

afterEach(()=>vi.unstubAllGlobals())

describe('packing specification PDF',()=>{
 it('calculates packages and extra pieces accurately',()=>{
  expect(packingCalculation(35,0,15,'шишиња')).toBe('35 x 15 = 525 шишиња')
  expect(packingCalculation(10,2,15,'шишиња')).toBe('10 x 15 + 2 = 152 шишиња')
  expect(packingCalculation(5,1,6,'БиБ')).toBe('5 x 6 + 1 = 31 БиБ')
 })
 it('generates a valid one-page PDF with the Cyrillic font',async()=>{
  const cyrillic=await readFile(new URL('../../node_modules/@fontsource/noto-sans/files/noto-sans-cyrillic-400-normal.woff',import.meta.url)),latin=await readFile(new URL('../../node_modules/@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff',import.meta.url))
  vi.stubGlobal('fetch',vi.fn(async(input:string|URL|Request)=>new Response(String(input).includes('latin-')?latin:cyrillic,{status:200})))
  const bytes=await createOrderPdf(sample)
  expect(new TextDecoder().decode(bytes.slice(0,8))).toContain('%PDF-')
  expect(bytes.length).toBeGreaterThan(5_000)
 },15_000)
})

import notoSansUrl from '@fontsource/noto-sans/files/noto-sans-cyrillic-400-normal.woff?url'
import notoSansLatinUrl from '@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff?url'
import type { Order } from '../types'
import { breakdown, productName } from './logic'

const filename=(order:Order)=>`${order.number.replace(/^PG-/,'SP-')}-${order.client.replace(/[^a-zA-Z0-9а-яА-ЯЀ-ӿ_-]+/g,'-')}.pdf`

export async function createOrderPdf(order:Order){
 const [{PDFDocument,rgb},fontkitModule]=await Promise.all([import('pdf-lib'),import('@pdf-lib/fontkit')])
 const document=await PDFDocument.create();document.registerFontkit(fontkitModule.default)
 const [cyrillicBytes,latinBytes]=await Promise.all([notoSansUrl,notoSansLatinUrl].map(url=>fetch(url).then(response=>{if(!response.ok)throw new Error('Не може да се вчита PDF фонтот.');return response.arrayBuffer()})))
 const cyrillic=await document.embedFont(cyrillicBytes,{subset:true}),latin=await document.embedFont(latinBytes,{subset:true}),page=document.addPage([595.28,841.89]),{width}=page.getSize()
 const runs=(text:string)=>[...text].reduce<Array<{text:string;font:typeof latin}>>((result,char)=>{const font=/[\u0400-\u052f]/.test(char)?cyrillic:latin,last=result.at(-1);if(last?.font===font)last.text+=char;else result.push({text:char,font});return result},[])
 const textWidth=(text:string,size:number)=>runs(text).reduce((sum,run)=>sum+run.font.widthOfTextAtSize(run.text,size),0)
 const draw=(text:string,x:number,y:number,size=11,color=rgb(0.08,0.11,0.14))=>{runs(text).forEach(run=>{page.drawText(run.text,{x,y,size,font:run.font,color});x+=run.font.widthOfTextAtSize(run.text,size)})}
 const center=(text:string,y:number,size:number)=>draw(text,(width-textWidth(text,size))/2,y,size)
 center('СПЕЦИФИКАЦИЈА ЗА ПАКУВАЊЕ',790,18);page.drawLine({start:{x:42,y:777},end:{x:553,y:777},thickness:1.4,color:rgb(0.08,0.11,0.14)})
 draw('Број на спецификација',42,746,8,rgb(.4,.43,.46));draw(order.number.replace(/^PG-/,'SP-'),42,727,16)
 draw('Клиент',300,746,8,rgb(.4,.43,.46));draw(order.client,300,727,16)
 draw('Датум',42,697,8,rgb(.4,.43,.46));draw(order.date,42,681,11)
 draw('Град',300,697,8,rgb(.4,.43,.46));draw(order.city,300,681,11)
 const rows=[
  [productName('p025'),breakdown(order.qty025,order.qty025Pieces||0),'15 шишиња'],
  [productName('p15'),breakdown(order.qty15,order.qty15Pieces||0),'6 БиБ'],
  [`Гратис ${productName('p025')}`,`${breakdown(order.free025,order.free025Pieces||0)} • одделно`,'15 шишиња'],
  [productName('flyers'),`${order.flyers} парчиња`,'—'],
 ]
 const left=42,top=642,rowHeight=46,columns=[left,255,425,553]
 page.drawRectangle({x:left,y:top,width:511,height:32,color:rgb(.91,.93,.94)})
 ;['Производ','Количина','Бр. во пакет'].forEach((label,index)=>draw(label,columns[index]+8,top+11,9))
 rows.forEach((row,index)=>{const y=top-(index+1)*rowHeight;page.drawRectangle({x:left,y,width:511,height:rowHeight,borderWidth:.7,borderColor:rgb(.62,.65,.67)});row.forEach((value,column)=>draw(value,columns[column]+8,y+17,column===0?10:9))})
 const noteY=top-(rows.length+1)*rowHeight-14;draw('Забелешка',left,noteY+34,8,rgb(.4,.43,.46));draw(order.note||'—',left,noteY+14,10)
 draw('Спакувал',left,90,9);page.drawLine({start:{x:105,y:88},end:{x:270,y:88},thickness:.7,color:rgb(.2,.2,.2)})
 return document.save()
}

export async function shareOrderPdf(order:Order){
 const bytes=await createOrderPdf(order),blob=new Blob([bytes.buffer as ArrayBuffer],{type:'application/pdf'}),file=new File([blob],filename(order),{type:'application/pdf'})
 if(navigator.share&&navigator.canShare?.({files:[file]})){await navigator.share({files:[file],title:`Спецификација ${order.number}`,text:`Спецификација за пакување за ${order.client}`});return 'shared' as const}
 const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=file.name;link.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);return 'downloaded' as const
}

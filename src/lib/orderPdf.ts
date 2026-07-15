import notoSansUrl from '@fontsource/noto-sans/files/noto-sans-cyrillic-400-normal.woff?url'
import notoSansLatinUrl from '@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff?url'
import notoSansBoldUrl from '@fontsource/noto-sans/files/noto-sans-cyrillic-700-normal.woff?url'
import notoSansLatinBoldUrl from '@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff?url'
import type { Order } from '../types'
import { formatDocumentDate } from './date'
import { productName } from './logic'
import { createOrderQrDataUrl } from './orderQr'

const filename=(order:Order)=>`${order.number.replace(/^PG-/,'SP-')}-${order.client.replace(/[^a-zA-Z0-9а-яА-ЯЀ-ӿ_-]+/g,'-')}.pdf`
const quantity=(packages:number,pieces:number)=>`${packages} пакети${pieces?` + ${pieces} парчиња`:''}`
export const packingCalculation=(packages:number,pieces:number,perPackage:number,unit:string)=>`${packages} x ${perPackage}${pieces?` + ${pieces}`:''} = ${packages*perPackage+pieces} ${unit}`

export async function createOrderPdf(order:Order){
 const [{PDFDocument,rgb},fontkitModule,qrDataUrl]=await Promise.all([import('pdf-lib'),import('@pdf-lib/fontkit'),createOrderQrDataUrl(order.id)])
 const document=await PDFDocument.create();document.registerFontkit(fontkitModule.default)
 const fontUrls=[notoSansUrl,notoSansLatinUrl,notoSansBoldUrl,notoSansLatinBoldUrl]
 const fontBytes=await Promise.all(fontUrls.map(url=>fetch(url).then(response=>{if(!response.ok)throw new Error('Не може да се вчита PDF фонтот.');return response.arrayBuffer()})))
 const [cyrillic,latin,cyrillicBold,latinBold]=await Promise.all(fontBytes.map(bytes=>document.embedFont(bytes,{subset:true})))
 const qrImage=await document.embedPng(qrDataUrl)
 const page=document.addPage([595.28,841.89]),{width}=page.getSize(),ink=rgb(.06,.07,.08),muted=rgb(.35,.37,.39),line=rgb(.38,.4,.42),pale=rgb(.94,.95,.95)
 const fontPair=(bold=false)=>bold?{cyrillic:cyrillicBold,latin:latinBold}:{cyrillic,latin}
 const runs=(text:string,bold=false)=>[...text].reduce<Array<{text:string;font:typeof latin}>>((result,char)=>{const pair=fontPair(bold),font=/[\u0400-\u052f]/.test(char)?pair.cyrillic:pair.latin,last=result.at(-1);if(last?.font===font)last.text+=char;else result.push({text:char,font});return result},[])
 const textWidth=(text:string,size:number,bold=false)=>runs(text,bold).reduce((sum,run)=>sum+run.font.widthOfTextAtSize(run.text,size),0)
 const draw=(text:string,x:number,y:number,size=10,bold=false,color=ink)=>{runs(text,bold).forEach(run=>{page.drawText(run.text,{x,y,size,font:run.font,color});x+=run.font.widthOfTextAtSize(run.text,size)})}
 const fit=(text:string,maxWidth:number,size:number,bold=false,minSize=7)=>{let fitted=size;while(fitted>minSize&&textWidth(text,fitted,bold)>maxWidth)fitted-=.5;return fitted}
 const center=(text:string,y:number,size:number,bold=false)=>draw(text,(width-textWidth(text,size,bold))/2,y,size,bold)
 const rect=(x:number,y:number,w:number,h:number,fill?:typeof pale)=>page.drawRectangle({x,y,width:w,height:h,borderWidth:.7,borderColor:line,...(fill?{color:fill}:{})})
 const meta=(label:string,value:string,x:number,y:number,w:number,h:number,large=false)=>{rect(x,y,w,h);draw(label.toUpperCase(),x+10,y+h-17,7,true,muted);draw(value,x+10,y+13,fit(value,w-20,large?18:12,true),true)}

 center('СПЕЦИФИКАЦИЈА ЗА ПАКУВАЊЕ',792,18,true)
 page.drawImage(qrImage,{x:500,y:782,width:50,height:50})
 page.drawLine({start:{x:42,y:775},end:{x:553,y:775},thickness:2,color:ink})

 const left=42,right=553,gap=8,leftMeta=210,rightMeta=293
 meta('Број на спецификација',order.number.replace(/^PG-/,'SP-'),left,716,leftMeta,48,true)
 meta('Клиент',order.client,left+leftMeta+gap,716,rightMeta,48,true)
 meta('Датум',formatDocumentDate(order.date),left,660,leftMeta,48)
 meta('Град',order.city,left+leftMeta+gap,660,rightMeta,48)

 const columns=[left,164,278,369,right]
 const headerTop=645,headerHeight=31
 rect(left,headerTop-headerHeight,right-left,headerHeight,pale)
 ;['Производ','Количина','Бр. во пакет','Пакување'].forEach((label,index)=>draw(label,columns[index]+8,headerTop-20,8,true))
 for(const x of columns.slice(1,-1))page.drawLine({start:{x,y:headerTop-headerHeight},end:{x,y:headerTop},thickness:.7,color:line})

 const rows=[
  {height:44,product:productName('p025'),amount:quantity(order.qty025,order.qty025Pieces||0),inPackage:'15 шишиња',packing:packingCalculation(order.qty025,order.qty025Pieces||0,15,'шишиња')},
  {height:44,product:productName('p15'),amount:quantity(order.qty15,order.qty15Pieces||0),inPackage:'6 БиБ',packing:packingCalculation(order.qty15,order.qty15Pieces||0,6,'БиБ')},
  {height:56,product:`Гратис ${productName('p025')}`,sub:'Се пакува одделно',amount:quantity(order.free025,order.free025Pieces||0),inPackage:'15 шишиња',packing:packingCalculation(order.free025,order.free025Pieces||0,15,'шишиња'),packingSub:'ОДДЕЛНО'},
  {height:56,product:`Гратис ${productName('p15')}`,sub:'Се пакува одделно',amount:quantity(order.free15||0,order.free15Pieces||0),inPackage:'6 БиБ',packing:packingCalculation(order.free15||0,order.free15Pieces||0,6,'БиБ'),packingSub:'ОДДЕЛНО'},
  {height:44,product:productName('flyers'),amount:`${order.flyers} парчиња`,inPackage:'-',packing:`${order.flyers} парчиња`},
 ]
 let rowTop=headerTop-headerHeight
 for(const row of rows){
  const y=rowTop-row.height;rect(left,y,right-left,row.height)
  for(const x of columns.slice(1,-1))page.drawLine({start:{x,y},end:{x,y:rowTop},thickness:.7,color:line})
  const baseline=y+(row.sub||row.packingSub?31:19)
  draw(row.product,columns[0]+8,baseline,fit(row.product,columns[1]-columns[0]-16,10,true),true)
  if(row.sub)draw(row.sub,columns[0]+8,y+13,7,true,muted)
  draw(row.amount,columns[1]+8,baseline,fit(row.amount,columns[2]-columns[1]-16,9),false)
  draw(row.inPackage,columns[2]+8,baseline,fit(row.inPackage,columns[3]-columns[2]-16,9),false)
  draw(row.packing,columns[3]+8,baseline,fit(row.packing,columns[4]-columns[3]-16,9,true),true)
  if(row.packingSub)draw(row.packingSub,columns[3]+8,y+13,7,true,muted)
  rowTop=y
 }

 const noteHeight=72,noteY=rowTop-noteHeight-12
 rect(left,noteY,right-left,noteHeight)
 draw('ЗАБЕЛЕШКА',left+10,noteY+52,8,true,muted)
 draw(order.note||'________________________________________________________________',left+10,noteY+25,fit(order.note||'________________________________________________________________',right-left-20,10),false)
 draw('Спакувал',left,245,10,true)
 page.drawLine({start:{x:105,y:243},end:{x:310,y:243},thickness:.7,color:ink})
 return document.save()
}

export async function shareOrderPdf(order:Order){
 const bytes=await createOrderPdf(order),blob=new Blob([bytes.buffer as ArrayBuffer],{type:'application/pdf'}),file=new File([blob],filename(order),{type:'application/pdf'})
 if(navigator.share&&navigator.canShare?.({files:[file]})){await navigator.share({files:[file],title:`Спецификација ${order.number}`,text:`Спецификација за пакување за ${order.client}`});return 'shared' as const}
 const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=file.name;link.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);return 'downloaded' as const
}

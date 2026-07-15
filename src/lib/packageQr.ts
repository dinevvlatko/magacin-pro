import type { AppState, Order, PackageQrItem } from '../types'
import { updatePackedItem } from './logic'

const prefix='MAGACIN-PRO|1'
const items:PackageQrItem[]=['regular025','bib15','free025','free15']
const itemInfo:Record<PackageQrItem,{label:string;short:string;packages:(order:Order)=>number;pieces:(order:Order)=>number}>={
 regular025:{label:'Шише 0.250 мл',short:'Sise 0.250 ml',packages:o=>o.qty025,pieces:o=>o.qty025Pieces||0},
 bib15:{label:'БиБ 1,5 Л',short:'BiB 1.5 L',packages:o=>o.qty15,pieces:o=>o.qty15Pieces||0},
 free025:{label:'Гратис Шише 0.250 мл',short:'Gratis Sise 0.250 ml',packages:o=>o.free025,pieces:o=>o.free025Pieces||0},
 free15:{label:'Гратис БиБ 1,5 Л',short:'Gratis BiB 1.5 L',packages:o=>o.free15||0,pieces:o=>o.free15Pieces||0},
}

export const packageQrRows=(order:Order)=>items.map(item=>({item,label:itemInfo[item].label,packages:itemInfo[item].packages(order),pieces:itemInfo[item].pieces(order),scanned:new Set(order.scannedPackages?.[item]||[]).size})).filter(row=>row.packages>0)
export const packageQrValue=(order:Order,item:PackageQrItem,index:number)=>`${prefix}|${order.id}|${item}|${index}`

export function scanPackageQr(state:AppState,selectedOrderId:string,value:string):{state:AppState;message:string;error?:string}{
 const parts=value.trim().split('|')
 if(parts.length!==5||parts[0]!=='MAGACIN-PRO'||parts[1]!=='1')return {state,message:'',error:'Овој код не е MAGACIN PRO QR етикета.'}
 const [, ,orderId,itemRaw,indexRaw]=parts
 const item=itemRaw as PackageQrItem,index=Number(indexRaw)
 if(!items.includes(item)||!Number.isInteger(index)||index<1)return {state,message:'',error:'QR кодот има невалидни податоци.'}
 if(orderId!==selectedOrderId)return {state,message:'',error:'QR кодот е од друга нарачка.'}
 const order=state.orders.find(candidate=>candidate.id===orderId)
 if(!order)return {state,message:'',error:'Нарачката од QR кодот не постои.'}
 if(order.status==='Чека залиха')return {state,message:'',error:'Нарачката сè уште чека залиха.'}
 if(order.stockDeducted)return {state,message:'',error:'Нарачката е веќе спакувана и одземена од магацин.'}
 const info=itemInfo[item],required=info.packages(order)
 if(index>required)return {state,message:'',error:'Овој пакет не припаѓа на количината во нарачката.'}
 const already=new Set(order.scannedPackages?.[item]||[])
 if(already.has(index))return {state,message:`Пакет ${index}/${required} е веќе скениран.`,error:'duplicate'}
 already.add(index)
 const updatedOrder={...order,scannedPackages:{...order.scannedPackages,[item]:[...already].sort((a,b)=>a-b)}}
 let next={...state,orders:state.orders.map(candidate=>candidate.id===order.id?updatedOrder:candidate)}
 if(already.size===required&&info.pieces(order)===0){
  const checked=updatePackedItem(next,order.id,item,true)
  if(!checked)return {state,message:'',error:'Нема доволно залиха за да се заврши оваа нарачка.'}
  next=checked
 }
 return {state:next,message:`Скенирано: ${info.label} • ${index}/${required}`}
}

export async function downloadPackageQrLabels(order:Order){
 const [{PDFDocument,StandardFonts,rgb},{default:QRCode}]=await Promise.all([import('pdf-lib'),import('qrcode')])
 const labels=items.flatMap(item=>Array.from({length:itemInfo[item].packages(order)},(_,index)=>({item,index:index+1,total:itemInfo[item].packages(order),name:itemInfo[item].short,value:packageQrValue(order,item,index+1)})))
 if(!labels.length)throw new Error('Нарачката нема пакети за QR етикети.')
 const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold)
 const pageWidth=595.28,pageHeight=841.89,margin=24,cols=3,rows=5,gap=8,cellW=(pageWidth-margin*2-gap*(cols-1))/cols,cellH=(pageHeight-margin*2-gap*(rows-1))/rows
 for(let start=0;start<labels.length;start+=cols*rows){
  const page=pdf.addPage([pageWidth,pageHeight])
  const batch=labels.slice(start,start+cols*rows)
  const pngs=await Promise.all(batch.map(label=>QRCode.toDataURL(label.value,{margin:1,width:280,errorCorrectionLevel:'M'}).then(data=>pdf.embedPng(data))))
  batch.forEach((label,i)=>{const col=i%cols,row=Math.floor(i/cols),x=margin+col*(cellW+gap),y=pageHeight-margin-(row+1)*cellH-row*gap;page.drawRectangle({x,y,width:cellW,height:cellH,borderColor:rgb(.65,.7,.74),borderWidth:.7});const qrSize=Math.min(104,cellH-42);page.drawImage(pngs[i],{x:x+(cellW-qrSize)/2,y:y+36,width:qrSize,height:qrSize});page.drawText(order.number,{x:x+8,y:y+24,size:9,font:bold});page.drawText(label.name,{x:x+8,y:y+13,size:8,font});page.drawText(`${label.index}/${label.total}`,{x:x+cellW-34,y:y+13,size:9,font:bold})})
 }
 const bytes=await pdf.save(),blob=new Blob([bytes as BlobPart],{type:'application/pdf'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`QR-etiketi-${order.number}.pdf`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}

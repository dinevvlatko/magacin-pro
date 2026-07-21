const productionOrigin='https://magacin-pro-ten.vercel.app'

export const orderQrUrl=(orderId:string,origin=typeof window!=='undefined'?window.location.origin:productionOrigin)=>{
 const url=new URL('/',origin)
 url.searchParams.set('order',orderId)
 return url.toString()
}

export async function createOrderQrDataUrl(orderId:string,origin?:string){
 const {default:QRCode}=await import('qrcode')
 return QRCode.toDataURL(orderQrUrl(orderId,origin),{width:320,margin:1,errorCorrectionLevel:'M'})
}

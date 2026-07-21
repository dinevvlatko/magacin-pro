import { registerSW } from 'virtual:pwa-register'

export const appVersion=__APP_VERSION__

if(import.meta.env.PROD&&'serviceWorker' in navigator){
 let reloading=false
 const reload=()=>{if(!reloading){reloading=true;window.location.reload()}}
 const updateSW=registerSW({
  immediate:true,
  onNeedRefresh:()=>{void updateSW(true)},
  onNeedReload:reload,
  onRegisteredSW:(_url,registration)=>{
   if(!registration)return
   const checkForUpdate=async()=>{
    if(!navigator.onLine)return
    try{
     const response=await fetch(`/version.json?t=${Date.now()}`,{cache:'no-store'})
     if(!response.ok)return
     const remote=await response.json() as {version?:string}
     if(remote.version&&remote.version!==appVersion)await registration.update()
    }catch{
     // Offline and temporary network failures keep the installed app usable.
    }
   }
   void checkForUpdate()
   window.addEventListener('focus',checkForUpdate)
   document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void checkForUpdate()})
   window.setInterval(checkForUpdate,5*60*1000)
  },
 })
 navigator.serviceWorker.addEventListener('controllerchange',reload)
}

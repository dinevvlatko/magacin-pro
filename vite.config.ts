import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const appVersion=process.env.VERCEL_GIT_COMMIT_SHA?.slice(0,7)||`local-${Date.now()}`
const versionFile:Plugin={
 name:'magacin-pro-version',
 generateBundle(){this.emitFile({type:'asset',fileName:'version.json',source:JSON.stringify({version:appVersion})})},
}

export default defineConfig({
 define:{__APP_VERSION__:JSON.stringify(appVersion)},
 plugins:[
  react(),
  versionFile,
  VitePWA({
   registerType:'autoUpdate',
   includeAssets:['icon.svg','apple-touch-icon.svg'],
   manifest:{name:'Magacin Pro',short_name:'Magacin Pro',description:'Магацин, нарачки, пакување и испораки',lang:'mk',theme_color:'#071018',background_color:'#071018',display:'standalone',start_url:'/',orientation:'any',icons:[{src:'/icon.svg',sizes:'any',type:'image/svg+xml',purpose:'any maskable'},{src:'/apple-touch-icon.svg',sizes:'180x180',type:'image/svg+xml'}]},
   workbox:{globPatterns:['**/*.{js,css,html,svg,png,ico}'],cleanupOutdatedCaches:true},
  }),
 ],
})

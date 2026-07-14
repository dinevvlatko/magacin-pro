import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
export default defineConfig({plugins:[react(),VitePWA({registerType:'autoUpdate',includeAssets:['icon.svg','apple-touch-icon.svg'],manifest:{name:'Magacin Pro',short_name:'Magacin Pro',description:'Магацин, нарачки, пакување и испораки',lang:'mk',theme_color:'#071018',background_color:'#071018',display:'standalone',start_url:'/',orientation:'any',icons:[{src:'/icon.svg',sizes:'any',type:'image/svg+xml',purpose:'any maskable'},{src:'/apple-touch-icon.svg',sizes:'180x180',type:'image/svg+xml'}]},workbox:{globPatterns:['**/*.{js,css,html,svg,png,ico}']}})]})

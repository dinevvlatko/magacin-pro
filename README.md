# Magacin Pro

Responsive React + Vite + TypeScript PWA for warehouse, orders, packing and deliveries.

## Run locally
```bash
npm install
npm run dev
```

## Production build
```bash
npm run build
npm run preview
```

## Deploy on Vercel
1. Push the project to GitHub.
2. In Vercel choose **Add New Project** and import the repository.
3. Framework preset: **Vite**.
4. Build command: `npm run build`.
5. Output directory: `dist`.
6. Deploy.

## Add to iPhone Home Screen
1. Open the deployed HTTPS URL in Safari.
2. Tap **Share**.
3. Choose **Add to Home Screen**.
4. Confirm **Add**. The app opens in standalone mode.

## Architecture
- `src/components` reusable UI and navigation
- `src/lib/data.ts` demo seed and order-number logic
- `src/lib/logic.ts` stock, reservation and normalization logic
- `src/lib/storage.ts` localStorage persistence adapter
- `src/types.ts` TypeScript domain types
- `src/App.tsx` feature screens and workflows

The storage layer is isolated so it can later be replaced by Supabase repositories and authentication.
"# magacin-pro" 

declare module '*.css';
// The subset of Vite's import.meta.env that the page uses (vite/client types are not loaded by tsc here).
interface ImportMetaEnv { readonly DEV: boolean }
interface ImportMeta { readonly env: ImportMetaEnv }

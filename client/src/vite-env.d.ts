/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GSC_VERIFICATION?: string;
  readonly VITE_BING_VERIFICATION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

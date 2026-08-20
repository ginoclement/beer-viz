/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Base URL of the beer-api (e.g. https://apis.ginoclement.com/beer). When set,
   * the per-recipe views fetch from the API instead of bundling corpus.json.
   * Unset → local/offline mode using the bundled generated JSON.
   */
  readonly VITE_BEER_API_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

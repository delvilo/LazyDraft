declare module 'trumbowyg' {
  const runtime: unknown;
  export default runtime;
}
declare module 'trumbowyg/dist/plugins/history/trumbowyg.history.js' {
  const runtime: unknown;
  export default runtime;
}
declare module 'trumbowyg/dist/plugins/preformatted/trumbowyg.preformatted.js' {
  const runtime: unknown;
  export default runtime;
}
declare module 'trumbowyg/dist/ui/trumbowyg.min.css';
declare module 'trumbowyg/dist/ui/icons.svg?raw' {
  const svg: string;
  export default svg;
}

interface TrumbowygBtnDef {
  fn?: string | ((value?: unknown) => void | boolean);
  title?: string;
  ico?: string;
}

interface TrumbowygOptions {
  svgPath?: string;
  semantic?: boolean;
  semanticKeepAttributes?: boolean;
  tagsToKeep?: string[];
  tagsToRemove?: string[];
  btns?: string[][];
  btnsDef?: Record<string, TrumbowygBtnDef>;
}

interface TrumbowygInstance {
  $ed: JQuery;
  btnsDef: Record<string, TrumbowygBtnDef>;
  saveRange(): void;
  html(): string;
  syncTextarea(): void;
  syncCode(force?: boolean): void;
  execCmd(command: string, parameter?: string, forceCSS?: boolean, skipTrumbowyg?: boolean): void;
  toggle(): void;
  destroy(): void;
}

interface JQuery {
  trumbowyg(options: TrumbowygOptions): JQuery;
  data(key: 'trumbowyg'): TrumbowygInstance;
}

interface Window {
  jQuery?: JQueryStatic;
}

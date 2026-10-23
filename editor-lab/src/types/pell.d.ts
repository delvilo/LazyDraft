declare module 'pell' {
  export interface PellActionConfig {
    name?: string;
    icon?: string;
    title?: string;
    state?: () => boolean | number;
    result: () => void | boolean;
  }

  export type PellAction = string | PellActionConfig;

  export interface PellClasses {
    actionbar?: string;
    button?: string;
    content?: string;
    selected?: string;
  }

  export interface PellOptions {
    element: HTMLElement;
    onChange: (html: string) => void;
    defaultParagraphSeparator?: string;
    styleWithCSS?: boolean;
    actions?: PellAction[];
    classes?: PellClasses;
  }

  export interface PellElement extends HTMLElement {
    content: HTMLDivElement;
  }

  export function exec(command: string, value?: string | null): boolean;
  export function init(settings: PellOptions): PellElement;

  const pell: {
    exec: typeof exec;
    init: typeof init;
  };
  export default pell;
}

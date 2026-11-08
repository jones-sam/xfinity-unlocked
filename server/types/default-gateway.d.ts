declare module 'default-gateway' {
  export interface Gateway {
    gateway: string;
    interface?: string;
  }

  export function gateway4(): Promise<Gateway>;
  export function gateway4async(): Promise<Gateway>;
  export function gateway6(): Promise<Gateway>;
  export function gateway6async(): Promise<Gateway>;
}

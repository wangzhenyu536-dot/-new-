export const validRows: (string | number | null)[][];
export function workbook(rows?: (string | number | null)[][], multiple?: boolean): Promise<Uint8Array>;
export function mutateWorkbook(bytes: Uint8Array, edit: (files: Record<string, Uint8Array>) => void): Uint8Array;
export function editSheet(bytes: Uint8Array, edit: (xml: string) => string): Uint8Array;

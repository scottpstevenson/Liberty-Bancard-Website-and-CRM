/** CSV text, not a spreadsheet formula; numbers remain numeric observations. */
export function residualExportCell(value:unknown):string|number {
  if(value==null)return "Unavailable";
  if(typeof value==="number")return Number.isFinite(value)?value:"Unavailable";
  const text=String(value);
  return /^[\s]*[=+\-@]/.test(text)||/^[\t\r\n]/.test(text)?`'${text}`:text;
}

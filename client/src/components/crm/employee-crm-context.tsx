import { createContext, useContext, useRef, type ReactNode } from "react";

const EmployeeCrmContext = createContext(false);

export function EmployeeCrmProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  return (
    <EmployeeCrmContext.Provider value={enabled}>
      {children}
    </EmployeeCrmContext.Provider>
  );
}

export function useEmployeeCrm() {
  return useContext(EmployeeCrmContext);
}

export function crmPortalClass(enabled: boolean) {
  return enabled ? "crm-theme crm-portal" : undefined;
}
/** Manual state-controlled CRM dialogs may not have a Radix Trigger ref.
 * Preserve caller focus handlers and never restore a detached prior context. */
export function useCrmModalFocus(enabled:boolean,
  open?:(event:Event)=>void, close?:(event:Event)=>void){
  const previous=useRef<HTMLElement|null>(null);
  return {
    onOpenAutoFocus:(event:Event)=>{
      if(enabled)previous.current=document.activeElement as HTMLElement|null;
      open?.(event);
    },
    onCloseAutoFocus:(event:Event)=>{
      close?.(event);
      if(enabled && !event.defaultPrevented && previous.current?.isConnected){
        event.preventDefault();previous.current.focus();
      }
    },
  };
}

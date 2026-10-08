import {useLayoutEffect,useRef} from "react";
import {useToast} from "./use-toast";

/** An unmounted record cannot notify the next record, even for the same actor. */
export function useOwnedToast(){
  const notifications=useToast();
  const mounted=useRef(true);
  useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false};},[]);
  return {...notifications,toast:(...args:Parameters<typeof notifications.toast>)=>{
    if(mounted.current)return notifications.toast(...args);
    return {id:"detached-record",dismiss:()=>{},update:()=>{}};
  }};
}

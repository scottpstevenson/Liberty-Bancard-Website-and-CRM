import { useToast } from "@/hooks/use-toast"
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"
import { useAuth } from "@/hooks/use-auth"
import { useLocation } from "wouter"
import { useIsMobile } from "@/hooks/use-mobile"

export function Toaster() {
  const { toasts } = useToast()
  const { user } = useAuth()
  const [location] = useLocation()
  const isMobile = useIsMobile()
  const mobileDesktopOptOut = typeof window !== "undefined" && localStorage.getItem("prefer_desktop") === "true"
  const employeeRoute = ["admin", "manager", "agent"].includes(user?.role ?? "")
    && location.startsWith("/dashboard")
    && !location.startsWith("/dashboard/merchant-portal")
    && !location.startsWith("/dashboard/mobile")
    && location !== "/mobile"
    && (!isMobile || mobileDesktopOptOut)
  const portalClass = employeeRoute ? "crm-theme crm-portal" : undefined

  return (
    <ToastProvider>
      <div className={portalClass}>
      {toasts.map(function ({ id, title, description, action, protectedContext, ...props }) {
        return (
          <Toast key={id} {...props} className={props.className ? `${props.className} ${portalClass ?? ""}` : portalClass}>
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && (
                <ToastDescription>{description}</ToastDescription>
              )}
            </div>
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport className={portalClass} />
      </div>
    </ToastProvider>
  )
}

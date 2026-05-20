"use client"

import { useState, useEffect } from "react"
import { Bell } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useTranslations } from "next-intl"
import { useRouter } from "next/navigation"

interface Notification {
  id: string
  title: string
  body: string | null
  read: boolean
  createdAt: string
}

export function NotificationBell({ locale }: { locale: string }) {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [open, setOpen] = useState(false)
  const t = useTranslations("notifications")
  const router = useRouter()

  // A helper function to fetch the user's organization from the auth session.
  // In a real app we'd get this from Better Auth's useSession hook.
  // For now, we will simulate passing the proper header or fetching it.
  const orgId = typeof window !== 'undefined' ? localStorage.getItem('org_id') || 'system' : 'system'

  const fetchNotifications = async () => {
    try {
      const res = await fetch("/api/notifications", {
        headers: {
          'org_id': orgId
        }
      })
      if (res.ok) {
        const json = await res.json()
        setNotifications(json.data || [])
        setUnreadCount(json.data?.length || 0)
      }
    } catch (e) {
      console.error("Failed to fetch notifications", e)
    }
  }

  useEffect(() => {
    fetchNotifications()
    const interval = setInterval(fetchNotifications, 30000) // Poll every 30s
    return () => clearInterval(interval)
  }, [])

  const markAsRead = async (id: string) => {
    try {
      await fetch(`/api/notifications/${id}/read`, {
        method: "PATCH",
        headers: {
          'org_id': orgId
        }
      })
      fetchNotifications()
    } catch (e) {
      console.error("Failed to mark as read", e)
    }
  }

  const markAllRead = async () => {
    try {
      await fetch("/api/notifications/read-all", {
        method: "PATCH",
        headers: {
          'org_id': orgId
        }
      })
      fetchNotifications()
    } catch (e) {
      console.error("Failed to mark all as read", e)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute top-0 right-0 h-4 w-4 rounded-full bg-red-600 text-[10px] font-bold text-white flex items-center justify-center">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="flex items-center justify-between border-b px-4 py-2">
          <h4 className="font-semibold">{t("title")}</h4>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" onClick={markAllRead} className="text-xs text-blue-600 h-auto p-0">
              {t("markAllRead")}
            </Button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="p-4 text-center text-sm text-gray-500">{t("empty")}</div>
          ) : (
            notifications.map((notif) => (
              <div
                key={notif.id}
                className={`p-4 border-b last:border-b-0 cursor-pointer hover:bg-gray-50 transition-colors ${!notif.read ? 'bg-blue-50/50' : ''}`}
                onClick={() => {
                  if (!notif.read) markAsRead(notif.id)
                }}
              >
                <div className="font-medium text-sm">{notif.title}</div>
                {notif.body && <div className="text-xs text-gray-600 mt-1">{notif.body}</div>}
              </div>
            ))
          )}
        </div>
        <div className="border-t p-2">
          <Button
            variant="ghost"
            className="w-full text-sm"
            onClick={() => {
              setOpen(false)
              router.push(`/${locale}/notifications`)
            }}
          >
            {t("viewAll")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

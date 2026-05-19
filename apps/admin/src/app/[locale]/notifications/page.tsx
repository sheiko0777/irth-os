import { getTranslations } from "next-intl/server"
import { headers } from "next/headers"

interface Notification {
  id: string
  title: string
  body: string | null
  read: boolean
  createdAt: string
}

async function getNotifications(): Promise<Notification[]> {
  try {
    const reqHeaders = await headers();
    const orgId = reqHeaders.get('org_id') || 'system';
    
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/notifications`, {
      headers: {
        ...Object.fromEntries(reqHeaders.entries()),
        'org_id': orgId
      }
    })
    if (!res.ok) return []
    const json = await res.json()
    return json.data || []
  } catch (e) {
    console.error("Failed to fetch notifications", e)
    return []
  }
}

export default async function NotificationsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const t = await getTranslations("notifications")
  const notifications = await getNotifications()

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
      </div>

      <div className="bg-white rounded-md border">
        {notifications.length === 0 ? (
          <div className="p-8 text-center text-gray-500">{t("empty")}</div>
        ) : (
          <div className="divide-y">
            {notifications.map((notif) => (
              <div key={notif.id} className={`p-4 ${!notif.read ? 'bg-blue-50/50' : ''}`}>
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-medium">{notif.title}</h3>
                    {notif.body && <p className="text-sm text-gray-600 mt-1">{notif.body}</p>}
                  </div>
                  <span className="text-xs text-gray-500">
                    {new Date(notif.createdAt).toLocaleString(locale)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

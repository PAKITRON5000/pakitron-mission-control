// Mission Control on the phone: shows the notices the PC sends, and opens the right screen when one is touched.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('push', (e) => {
  const d = e.data ? e.data.json() : {}
  e.waitUntil(self.registration.showNotification(d.title || 'Mission Control', { body: d.body || '', icon: 'icon-192.png', badge: 'icon-192.png', data: { route: d.route || 'chats' } }))
})
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const url = `./#/${e.notification.data.route}`
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { c.navigate(url); return c.focus() }
    return self.clients.openWindow(url)
  }))
})

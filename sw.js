// sw.js - Simple Working Service Worker
console.log('✅ Service Worker loading...');

// Install - skip waiting
self.addEventListener('install', function(e) {
    console.log('✅ SW installed');
    e.waitUntil(self.skipWaiting());
});

// Activate - take control
self.addEventListener('activate', function(e) {
    console.log('✅ SW activated');
    e.waitUntil(self.clients.claim());
});

// Push notification
self.addEventListener('push', function(e) {
    console.log('📨 Push received!', e);
    
    let title = '📋 Task Update';
    let body = 'You have a new notification';
    let icon = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23667eea"%3E%3Cpath d="M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm2 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/%3E%3C/svg%3E';
    
    if (e.data) {
        try {
            const data = e.data.json();
            title = data.title || title;
            body = data.body || body;
            icon = data.icon || icon;
        } catch(err) {
            body = e.data.text();
        }
    }
    
    e.waitUntil(
        self.registration.showNotification(title, {
            body: body,
            icon: icon,
            badge: icon,
            vibrate: [200, 100, 200],
            requireInteraction: true,
            tag: 'task-notification',
            data: {
                url: '/'
            }
        })
    );
});

// Click notification
self.addEventListener('notificationclick', function(e) {
    console.log('🔔 Notification clicked');
    e.notification.close();
    e.waitUntil(
        clients.openWindow(e.notification.data?.url || '/')
    );
});

console.log('✅ Service Worker ready!');

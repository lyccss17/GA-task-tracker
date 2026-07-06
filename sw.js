// sw.js - Service Worker for push notifications
const CACHE_NAME = 'task-tracker-v1';

// Install event - cache static assets
self.addEventListener('install', function(event) {
    event.waitUntil(
        caches.open(CACHE_NAME).then(function(cache) {
            return cache.addAll([
                '/',
                '/icon-192.png',
                '/badge-72.png'
            ]);
        }).then(function() {
            return self.skipWaiting();
        })
    );
});

// Activate event - clean old caches
self.addEventListener('activate', function(event) {
    event.waitUntil(
        caches.keys().then(function(cacheNames) {
            return Promise.all(
                cacheNames.map(function(cacheName) {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(function() {
            return self.clients.claim();
        })
    );
});

// Push event - display notification
self.addEventListener('push', function(event) {
    console.log('Push event received:', event);

    let data = {
        title: 'Task Update',
        body: 'You have a new task notification',
        icon: '/icon-192.png',
        badge: '/badge-72.png',
        url: '/',
        timestamp: Date.now()
    };

    if (event.data) {
        try {
            const parsedData = event.data.json();
            data = { ...data, ...parsedData };
        } catch (e) {
            // If not JSON, use as text
            data.body = event.data.text();
        }
    }

    const options = {
        body: data.body,
        icon: data.icon || '/icon-192.png',
        badge: data.badge || '/badge-72.png',
        vibrate: [200, 100, 200],
        data: {
            url: data.url || '/',
            timestamp: data.timestamp || Date.now()
        },
        actions: [
            {
                action: 'open',
                title: 'View Task'
            },
            {
                action: 'dismiss',
                title: 'Dismiss'
            }
        ],
        requireInteraction: true,
        tag: `task-${Date.now()}`
    };

    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

// Notification click event
self.addEventListener('notificationclick', function(event) {
    console.log('Notification clicked:', event);

    event.notification.close();

    if (event.action === 'dismiss') {
        return;
    }

    // Open the app
    event.waitUntil(
        clients.matchAll({
            type: 'window',
            includeUncontrolled: true
        }).then(function(clientList) {
            // Check if there's already a window open
            for (let i = 0; i < clientList.length; i++) {
                const client = clientList[i];
                if (client.url.includes('/') && 'focus' in client) {
                    return client.focus();
                }
            }
            // Otherwise open a new window
            if (clients.openWindow) {
                const url = event.notification.data?.url || '/';
                return clients.openWindow(url);
            }
        })
    );
});

// Background sync - retry failed notifications
self.addEventListener('sync', function(event) {
    if (event.tag === 'task-sync') {
        event.waitUntil(
            // Retry logic for failed notifications
            fetch('/api/subscribe?check=true', {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            }).then(function(response) {
                return response.json();
            }).then(function(data) {
                console.log('Background sync completed:', data);
            }).catch(function(error) {
                console.error('Background sync failed:', error);
            })
        );
    }
});

// Handle offline requests
self.addEventListener('fetch', function(event) {
    event.respondWith(
        caches.match(event.request).then(function(response) {
            return response || fetch(event.request).catch(function() {
                // Return offline fallback
                return new Response('Offline - Task Tracker', {
                    status: 503,
                    statusText: 'Service Unavailable'
                });
            });
        })
    );
});

console.log('Service Worker loaded successfully');

// api/subscribe.js
const webPush = require('web-push');

const VAPID_PUBLIC = 'BA2dgrOQ-6pW9gt1C3kbdoAzzk5on-lKyI2cgSwlLo9tqRHChGit1Ik3xdZrEDvv8P4LUOVBo2qWWWDzA7huRs4';
const VAPID_PRIVATE = '4FfZ7SR4Qc1pdBCuQL4NDLtIQjxX1_6p-wCE8k9T0qw';

webPush.setVapidDetails(
    'mailto:your-email@example.com',
    VAPID_PUBLIC,
    VAPID_PRIVATE
);

// Store subscriptions in memory (use database in production)
let subscriptions = [];

module.exports = async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // GET - Check status or trigger notifications
    if (req.method === 'GET') {
        try {
            if (req.query.check === 'true') {
                // Send test notification to all subscribers
                for (const sub of subscriptions) {
                    try {
                        await webPush.sendNotification(sub, JSON.stringify({
                            title: '🔔 Test Notification',
                            body: 'Your notifications are working!',
                            icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23667eea"%3E%3Cpath d="M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm2 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/%3E%3C/svg%3E'
                        }));
                    } catch(e) {
                        // Remove invalid subscription
                        subscriptions = subscriptions.filter(s => s.endpoint !== sub.endpoint);
                    }
                }
                return res.json({ 
                    success: true, 
                    message: `Test notifications sent to ${subscriptions.length} subscribers`,
                    subscribers: subscriptions.length
                });
            }
            
            return res.json({ 
                success: true, 
                subscribers: subscriptions.length,
                message: 'Push service running'
            });
        } catch(e) {
            return res.status(500).json({ error: e.message });
        }
    }

    // POST - Subscribe
    if (req.method === 'POST') {
        try {
            const { subscription } = req.body;
            if (!subscription) {
                return res.status(400).json({ error: 'Missing subscription' });
            }

            // Check if exists
            const exists = subscriptions.some(s => s.endpoint === subscription.endpoint);
            if (!exists) {
                subscriptions.push(subscription);
                console.log(`✅ New subscription. Total: ${subscriptions.length}`);
            }

            // Send welcome notification
            try {
                await webPush.sendNotification(subscription, JSON.stringify({
                    title: '✅ Notifications Enabled!',
                    body: 'You will receive task updates',
                    icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%2334d399"%3E%3Cpath d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/%3E%3C/svg%3E'
                }));
            } catch(e) {
                console.log('Welcome notification failed:', e.message);
            }

            return res.json({ 
                success: true, 
                message: 'Subscribed!',
                total: subscriptions.length
            });

        } catch(e) {
            return res.status(500).json({ error: e.message });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
};

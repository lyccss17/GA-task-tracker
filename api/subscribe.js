// api/subscribe.js - Full Notification System
const webPush = require('web-push');

const VAPID_PUBLIC = 'BA2dgrOQ-6pW9gt1C3kbdoAzzk5on-lKyI2cgSwlLo9tqRHChGit1Ik3xdZrEDvv8P4LUOVBo2qWWWDzA7huRs4';
const VAPID_PRIVATE = '4FfZ7SR4Qc1pdBCuQL4NDLtIQjxX1_6p-wCE8k9T0qw';

webPush.setVapidDetails(
    'mailto:your-email@example.com',
    VAPID_PUBLIC,
    VAPID_PRIVATE
);

// Store subscriptions in memory
let subscriptions = [];

// Google Sheets API URL
const SHEET_API_URL = 'https://script.google.com/macros/s/AKfycbx9n4ZMpquNsIj0xYpx3scQDihzGa7zibbrZiVWanSS8dD1fVL_FRdnmnYKiduWhY3m/exec';

// Store previous state to detect changes
let previousState = {
    tasks: [],
    bulletins: [],
    lastCheck: null
};

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
                console.log('🔍 Checking for updates...');
                const result = await checkForUpdates();
                return res.json({ 
                    success: true, 
                    message: result.message || 'Check completed',
                    subscribers: subscriptions.length,
                    notifications: result.notifications || 0
                });
            }
            
            return res.json({ 
                success: true, 
                subscribers: subscriptions.length,
                message: 'Push service running'
            });
        } catch(e) {
            console.error('GET Error:', e);
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
                    body: 'You will receive notifications for: New Tasks, Overdue, Completed, and Bulletin posts',
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
            console.error('POST Error:', e);
            return res.status(500).json({ error: e.message });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
};

// ========== MAIN CHECK FUNCTION ==========
async function checkForUpdates() {
    try {
        console.log('📊 Fetching data from Google Sheets...');
        
        // Fetch all data
        const [tasks, bulletins] = await Promise.all([
            fetchData('getTasks'),
            fetchData('getBulletins')
        ]);

        console.log(`📋 Found ${tasks.length} tasks and ${bulletins.length} bulletins`);

        let notifications = [];
        let totalNotifications = 0;

        // 1. Check for NEW tasks
        if (previousState.tasks.length > 0 && tasks.length > previousState.tasks.length) {
            const newTasks = tasks.filter(task => {
                const taskId = task.id || task.taskid || task.taskId || task.ID;
                return !previousState.tasks.some(pt => {
                    const prevId = pt.id || pt.taskid || pt.taskId || pt.ID;
                    return prevId === taskId;
                });
            });

            for (const task of newTasks) {
                const title = task.title || task.Title || 'Task';
                const assignedTo = task.assignedto || task.assignedTo || 'someone';
                const store = task.store || '';
                notifications.push({
                    title: '📋 New Task Created',
                    body: `"${title}" assigned to ${assignedTo}${store ? ` (${store})` : ''}`,
                    icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23667eea"%3E%3Cpath d="M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm2 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/%3E%3C/svg%3E'
                });
                totalNotifications++;
                console.log(`✅ New task notification: ${title}`);
            }
        }

        // 2. Check for OVERDUE tasks
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayStr = today.toISOString().split('T')[0];

        for (const task of tasks) {
            const status = (task.status || '').toLowerCase();
            if (status === 'completed') continue;

            const dueDate = task.duedate || task.dueDate || task['Due Date'] || '';
            const taskId = task.id || task.taskid || task.taskId || task.ID;
            const title = task.title || task.Title || 'Task';
            const assignedTo = task.assignedto || task.assignedTo || '';

            // Check if overdue
            if (dueDate && dueDate < todayStr) {
                // Check if this is newly overdue (wasn't overdue before)
                const prevTask = previousState.tasks.find(pt => {
                    const prevId = pt.id || pt.taskid || pt.taskId || pt.ID;
                    return prevId === taskId;
                });

                if (prevTask) {
                    const prevStatus = (prevTask.status || '').toLowerCase();
                    const prevDueDate = prevTask.duedate || prevTask.dueDate || '';
                    // Only notify if it's newly overdue (status changed to not completed OR due date just passed)
                    if (prevDueDate !== dueDate || prevStatus === 'completed') {
                        notifications.push({
                            title: '⚠️ Task Overdue',
                            body: `"${title}" is overdue!${assignedTo ? ` 👤 ${assignedTo}` : ''}`,
                            icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23ef4444"%3E%3Cpath d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/%3E%3C/svg%3E'
                        });
                        totalNotifications++;
                        console.log(`✅ Overdue notification: ${title}`);
                    }
                }
            }
        }

        // 3. Check for COMPLETED tasks
        for (const task of tasks) {
            const status = (task.status || '').toLowerCase();
            const taskId = task.id || task.taskid || task.taskId || task.ID;
            const title = task.title || task.Title || 'Task';
            const assignedTo = task.assignedto || task.assignedTo || '';

            // Find previous state
            const prevTask = previousState.tasks.find(pt => {
                const prevId = pt.id || pt.taskid || pt.taskId || pt.ID;
                return prevId === taskId;
            });

            if (prevTask) {
                const prevStatus = (prevTask.status || '').toLowerCase();
                // Notify if task was just completed
                if (status === 'completed' && prevStatus !== 'completed') {
                    notifications.push({
                        title: '🎉 Task Completed',
                        body: `"${title}" completed by ${assignedTo || 'team member'}! 🎊`,
                        icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%2334d399"%3E%3Cpath d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/%3E%3C/svg%3E'
                    });
                    totalNotifications++;
                    console.log(`✅ Completed notification: ${title}`);
                }
            }
        }

        // 4. Check for NEW BULLETINS
        if (previousState.bulletins.length > 0 && bulletins.length > previousState.bulletins.length) {
            const newBulletins = bulletins.filter(bulletin => {
                const bId = bulletin.id || bulletin.bulletinid || bulletin.postid || bulletin['Bulletin ID'];
                return !previousState.bulletins.some(pb => {
                    const pId = pb.id || pb.bulletinid || pb.postid || pb['Bulletin ID'];
                    return pId === bId;
                });
            });

            for (const bulletin of newBulletins) {
                const content = bulletin.content || '';
                const type = bulletin.type || 'Note';
                const shortContent = content.length > 60 ? content.substring(0, 60) + '...' : content;
                
                let emoji = '📌';
                if (type === 'Announcement') emoji = '📢';
                else if (type === 'Reminder') emoji = '⏰';
                
                notifications.push({
                    title: `${emoji} New ${type} in Bulletin`,
                    body: shortContent,
                    icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23fbbf24"%3E%3Cpath d="M22 6h-4V3c0-1.1-.9-2-2-2H8c-1.1 0-2 .9-2 2v3H2v15h20V6zM8 3h8v3H8V3zm4 12c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/%3E%3C/svg%3E'
                });
                totalNotifications++;
                console.log(`✅ New bulletin notification: ${type} - ${shortContent}`);
            }
        }

        // Send all notifications
        let sentCount = 0;
        for (const notif of notifications) {
            const success = await sendNotificationToAll(notif.title, notif.body, notif.icon);
            if (success) sentCount++;
            // Small delay to avoid overwhelming
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Update state
        previousState.tasks = tasks;
        previousState.bulletins = bulletins;
        previousState.lastCheck = new Date().toISOString();

        console.log(`✅ Sent ${sentCount} notifications for ${notifications.length} events`);

        return {
            success: true,
            message: `Sent ${sentCount} notifications`,
            notifications: sentCount,
            events: notifications.length
        };

    } catch (error) {
        console.error('❌ Check error:', error);
        return {
            success: false,
            message: error.message,
            notifications: 0
        };
    }
}

// ========== HELPER FUNCTIONS ==========

// Fetch data from Google Sheets
async function fetchData(action) {
    try {
        const response = await fetch(`${SHEET_API_URL}?action=${action}`);
        const data = await response.json();
        return data || [];
    } catch (error) {
        console.error(`Fetch ${action} error:`, error);
        return [];
    }
}

// Send notification to all subscribers
async function sendNotificationToAll(title, body, icon) {
    const payload = JSON.stringify({ 
        title, 
        body, 
        icon: icon || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23667eea"%3E%3Cpath d="M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm2 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/%3E%3C/svg%3E',
        url: '/',
        timestamp: Date.now()
    });

    let sent = false;
    const failedSubscriptions = [];

    for (const sub of subscriptions) {
        try {
            await webPush.sendNotification(sub, payload);
            sent = true;
            console.log(`📨 Sent: "${title}"`);
        } catch (error) {
            console.log(`⚠️ Failed to send: ${error.statusCode}`);
            if (error.statusCode === 410 || error.statusCode === 404) {
                failedSubscriptions.push(sub);
            }
        }
    }

    // Remove invalid subscriptions
    if (failedSubscriptions.length > 0) {
        subscriptions = subscriptions.filter(sub => 
            !failedSubscriptions.some(failed => failed.endpoint === sub.endpoint)
        );
        console.log(`🗑️ Removed ${failedSubscriptions.length} invalid subscriptions`);
    }

    return sent;
}

// Initialize state on first run
async function initializeState() {
    try {
        const [tasks, bulletins] = await Promise.all([
            fetchData('getTasks'),
            fetchData('getBulletins')
        ]);
        previousState.tasks = tasks || [];
        previousState.bulletins = bulletins || [];
        previousState.lastCheck = new Date().toISOString();
        console.log(`📊 Initialized state: ${previousState.tasks.length} tasks, ${previousState.bulletins.length} bulletins`);
    } catch (error) {
        console.error('Init state error:', error);
    }
}

// Initialize
initializeState();

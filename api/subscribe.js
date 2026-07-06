// api/subscribe.js
const webPush = require('web-push');

// VAPID Keys
const VAPID_PUBLIC = 'BA2dgrOQ-6pW9gt1C3kbdoAzzk5on-lKyI2cgSwlLo9tqRHChGit1Ik3xdZrEDvv8P4LUOVBo2qWWWDzA7huRs4';
const VAPID_PRIVATE = '4FfZ7SR4Qc1pdBCuQL4NDLtIQjxX1_6p-wCE8k9T0qw';

// Configure web-push
webPush.setVapidDetails(
    'mailto:your-email@example.com',
    VAPID_PUBLIC,
    VAPID_PRIVATE
);

// Store subscriptions (in memory - use Redis/Database in production)
let subscriptions = [];

// Google Sheets API URL
const SHEET_API_URL = 'https://script.google.com/macros/s/AKfycbx9n4ZMpquNsIj0xYpx3scQDihzGa7zibbrZiVWanSS8dD1fVL_FRdnmnYKiduWhY3m/exec';

// Store previous state
let previousState = {
    tasks: [],
    bulletins: [],
    lastCheck: null
};

// Main handler
module.exports = async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // GET requests
    if (req.method === 'GET') {
        try {
            // Check for updates
            if (req.query && req.query.check === 'true') {
                console.log('🔍 Checking for updates...');
                const result = await checkForUpdates();
                return res.status(200).json({
                    success: true,
                    message: result.message || 'Check completed',
                    subscribers: subscriptions.length,
                    notifications: result.notifications || 0
                });
            }

            // Status check
            return res.status(200).json({
                success: true,
                subscribers: subscriptions.length,
                message: 'Push service running'
            });

        } catch (error) {
            console.error('GET Error:', error);
            return res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    // POST requests (Subscribe)
    if (req.method === 'POST') {
        try {
            const { subscription } = req.body;

            if (!subscription) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing subscription'
                });
            }

            // Check if already exists
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
                console.log('✅ Welcome notification sent');
            } catch (e) {
                console.log('⚠️ Welcome notification failed:', e.message);
            }

            return res.status(200).json({
                success: true,
                message: 'Subscribed successfully',
                total: subscriptions.length
            });

        } catch (error) {
            console.error('POST Error:', error);
            return res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    // Method not allowed
    return res.status(405).json({
        success: false,
        error: 'Method not allowed'
    });
};

// ========== CHECK FOR UPDATES ==========
async function checkForUpdates() {
    try {
        console.log('📊 Fetching data from Google Sheets...');
        
        // Fetch tasks and bulletins
        let tasks = [];
        let bulletins = [];
        
        try {
            const tasksResponse = await fetch(`${SHEET_API_URL}?action=getTasks`);
            if (tasksResponse.ok) {
                tasks = await tasksResponse.json();
                if (!Array.isArray(tasks)) tasks = [];
            }
        } catch (e) {
            console.log('⚠️ Failed to fetch tasks:', e.message);
        }

        try {
            const bulletinsResponse = await fetch(`${SHEET_API_URL}?action=getBulletins`);
            if (bulletinsResponse.ok) {
                bulletins = await bulletinsResponse.json();
                if (!Array.isArray(bulletins)) bulletins = [];
            }
        } catch (e) {
            console.log('⚠️ Failed to fetch bulletins:', e.message);
        }

        console.log(`📋 Found ${tasks.length} tasks and ${bulletins.length} bulletins`);

        let notifications = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayStr = today.toISOString().split('T')[0];

        // ========== 1. Check for NEW TASKS ==========
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
                    body: `"${title}" assigned to ${assignedTo}${store ? ` (${store})` : ''}`
                });
                console.log(`✅ New task: ${title}`);
            }
        }

        // ========== 2. Check for OVERDUE TASKS ==========
        for (const task of tasks) {
            const status = (task.status || '').toLowerCase();
            if (status === 'completed') continue;

            const dueDate = task.duedate || task.dueDate || task['Due Date'] || '';
            const taskId = task.id || task.taskid || task.taskId || task.ID;
            const title = task.title || task.Title || 'Task';
            const assignedTo = task.assignedto || task.assignedTo || '';

            if (dueDate && dueDate < todayStr) {
                // Check if this is newly overdue
                const prevTask = previousState.tasks.find(pt => {
                    const prevId = pt.id || pt.taskid || pt.taskId || pt.ID;
                    return prevId === taskId;
                });

                if (prevTask) {
                    const prevStatus = (prevTask.status || '').toLowerCase();
                    const prevDueDate = prevTask.duedate || prevTask.dueDate || '';
                    if (prevDueDate !== dueDate || prevStatus === 'completed') {
                        notifications.push({
                            title: '⚠️ Task Overdue',
                            body: `"${title}" is overdue!${assignedTo ? ` 👤 ${assignedTo}` : ''}`
                        });
                        console.log(`✅ Overdue: ${title}`);
                    }
                }
            }
        }

        // ========== 3. Check for COMPLETED TASKS ==========
        for (const task of tasks) {
            const status = (task.status || '').toLowerCase();
            const taskId = task.id || task.taskid || task.taskId || task.ID;
            const title = task.title || task.Title || 'Task';
            const assignedTo = task.assignedto || task.assignedTo || '';

            const prevTask = previousState.tasks.find(pt => {
                const prevId = pt.id || pt.taskid || pt.taskId || pt.ID;
                return prevId === taskId;
            });

            if (prevTask) {
                const prevStatus = (prevTask.status || '').toLowerCase();
                if (status === 'completed' && prevStatus !== 'completed') {
                    notifications.push({
                        title: '🎉 Task Completed',
                        body: `"${title}" completed by ${assignedTo || 'team member'}! 🎊`
                    });
                    console.log(`✅ Completed: ${title}`);
                }
            }
        }

        // ========== 4. Check for NEW BULLETINS ==========
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
                    title: `${emoji} New ${type}`,
                    body: shortContent
                });
                console.log(`✅ New bulletin: ${type}`);
            }
        }

        // ========== SEND NOTIFICATIONS ==========
        let sentCount = 0;
        for (const notif of notifications) {
            try {
                await sendNotificationToAll(notif.title, notif.body);
                sentCount++;
                await new Promise(resolve => setTimeout(resolve, 50));
            } catch (e) {
                console.log('⚠️ Failed to send:', e.message);
            }
        }

        // Update state
        previousState.tasks = tasks;
        previousState.bulletins = bulletins;
        previousState.lastCheck = new Date().toISOString();

        console.log(`✅ Sent ${sentCount} of ${notifications.length} notifications`);
        
        return {
            success: true,
            message: `Sent ${sentCount} notifications`,
            notifications: sentCount
        };

    } catch (error) {
        console.error('❌ Check error:', error);
        return {
            success: false,
            message: error.message,
            notifications: 0
        };
    }
};

// ========== SEND NOTIFICATION TO ALL ==========
async function sendNotificationToAll(title, body) {
    const payload = JSON.stringify({
        title: title,
        body: body,
        icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23667eea"%3E%3Cpath d="M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm2 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/%3E%3C/svg%3E',
        url: '/',
        timestamp: Date.now()
    });

    const failedSubscriptions = [];

    for (const sub of subscriptions) {
        try {
            await webPush.sendNotification(sub, payload);
            console.log(`📨 Sent: "${title}"`);
        } catch (error) {
            console.log(`⚠️ Failed: ${error.statusCode || error.message}`);
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

    return true;
}

// ========== INITIALIZE STATE ==========
async function initializeState() {
    try {
        console.log('📊 Initializing state...');
        
        let tasks = [];
        let bulletins = [];
        
        try {
            const tasksResponse = await fetch(`${SHEET_API_URL}?action=getTasks`);
            if (tasksResponse.ok) {
                tasks = await tasksResponse.json();
                if (!Array.isArray(tasks)) tasks = [];
            }
        } catch (e) {
            console.log('⚠️ Init tasks failed:', e.message);
        }

        try {
            const bulletinsResponse = await fetch(`${SHEET_API_URL}?action=getBulletins`);
            if (bulletinsResponse.ok) {
                bulletins = await bulletinsResponse.json();
                if (!Array.isArray(bulletins)) bulletins = [];
            }
        } catch (e) {
            console.log('⚠️ Init bulletins failed:', e.message);
        }

        previousState.tasks = tasks;
        previousState.bulletins = bulletins;
        previousState.lastCheck = new Date().toISOString();
        
        console.log(`📊 Initialized: ${tasks.length} tasks, ${bulletins.length} bulletins`);
    } catch (error) {
        console.error('❌ Init state error:', error);
    }
}

// Run initialization
initializeState();

console.log('🚀 Push notification service started!');

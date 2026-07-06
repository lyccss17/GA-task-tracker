// api/subscribe.js
const webPush = require('web-push');

// VAPID Keys from your provided data
const VAPID_PUBLIC_KEY = 'BA2dgrOQ-6pW9gt1C3kbdoAzzk5on-lKyI2cgSwlLo9tqRHChGit1Ik3xdZrEDvv8P4LUOVBo2qWWWDzA7huRs4';
const VAPID_PRIVATE_KEY = '4FfZ7SR4Qc1pdBCuQL4NDLtIQjxX1_6p-wCE8k9T0qw';

// Set VAPID details
webPush.setVapidDetails(
    'mailto:your-email@example.com', // Replace with your email
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
);

// In-memory storage for subscriptions (use Redis/Database in production)
let subscriptions = [];

// Google Sheets API URL
const SHEET_API_URL = 'https://script.google.com/macros/s/AKfycbx9n4ZMpquNsIj0xYpx3scQDihzGa7zibbrZiVWanSS8dD1fVL_FRdnmnYKiduWhY3m/exec';

module.exports = async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // GET: Check for updates and send notifications
    if (req.method === 'GET') {
        try {
            // Check if there are pending notifications to send
            if (req.query.check === 'true') {
                await checkForTaskUpdatesAndNotify();
                return res.status(200).json({ success: true, message: 'Notifications sent' });
            }
            
            // Get current subscriptions count
            return res.status(200).json({ 
                success: true, 
                subscriptions: subscriptions.length,
                message: 'Push service is running'
            });
        } catch (error) {
            console.error('GET Error:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    // POST: Register new subscription
    if (req.method === 'POST') {
        try {
            const { subscription } = req.body;
            
            if (!subscription) {
                return res.status(400).json({ error: 'Missing subscription' });
            }

            // Check if subscription already exists
            const exists = subscriptions.some(sub => 
                sub.endpoint === subscription.endpoint
            );

            if (!exists) {
                subscriptions.push(subscription);
                console.log('New subscription added. Total:', subscriptions.length);
            }

            // Send test notification
            try {
                await webPush.sendNotification(
                    subscription,
                    JSON.stringify({
                        title: '🔔 Notifications Enabled!',
                        body: 'You will now receive task updates',
                        url: '/',
                        icon: '/icon-192.png'
                    })
                );
            } catch (pushError) {
                console.error('Test notification failed:', pushError);
                // Remove invalid subscription
                subscriptions = subscriptions.filter(sub => 
                    sub.endpoint !== subscription.endpoint
                );
            }

            return res.status(201).json({ 
                success: true, 
                message: 'Subscribed successfully',
                total: subscriptions.length
            });

        } catch (error) {
            console.error('POST Error:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
};

// Function to check Google Sheets for task updates
async function checkForTaskUpdatesAndNotify() {
    try {
        // Fetch tasks from Google Sheets
        const response = await fetch(`${SHEET_API_URL}?action=getTasks`);
        const tasks = await response.json();

        if (!tasks || !Array.isArray(tasks)) {
            console.log('No tasks data');
            return;
        }

        // Check for tasks with due date today or overdue
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        
        // Store last checked state (in production, use a database)
        // We'll use a simple global variable for demo
        if (!global._lastTaskState) {
            global._lastTaskState = {};
        }

        let notificationsSent = 0;

        for (const task of tasks) {
            const taskId = task.id || task.taskid || task.taskId || task.ID;
            if (!taskId) continue;

            const dueDate = task.duedate || task.dueDate || task['Due Date'] || '';
            const status = (task.status || '').toLowerCase();
            const taskTitle = task.title || task.Title || 'Task';
            const assignedTo = task.assignedto || task.assignedTo || task['Assigned To'] || '';

            // Skip completed tasks
            if (status === 'completed') continue;

            // Check if due date is today
            if (dueDate === todayStr) {
                const key = `${taskId}_due_today`;
                if (!global._lastTaskState[key]) {
                    global._lastTaskState[key] = true;
                    await sendNotificationToAllSubscribers(
                        `📅 Task Due Today`,
                        `"${taskTitle}" is due today! ${assignedTo ? `Assigned to: ${assignedTo}` : ''}`
                    );
                    notificationsSent++;
                    console.log(`Sent due today notification for: ${taskTitle}`);
                }
            }

            // Check if overdue
            if (dueDate && dueDate < todayStr) {
                const key = `${taskId}_overdue`;
                if (!global._lastTaskState[key]) {
                    global._lastTaskState[key] = true;
                    await sendNotificationToAllSubscribers(
                        `⚠️ Task Overdue`,
                        `"${taskTitle}" is overdue! Original due: ${dueDate}`
                    );
                    notificationsSent++;
                    console.log(`Sent overdue notification for: ${taskTitle}`);
                }
            }

            // Check if status changed to "In Progress"
            if (status === 'in progress' || status === 'inprogress') {
                const key = `${taskId}_in_progress`;
                if (!global._lastTaskState[key]) {
                    global._lastTaskState[key] = true;
                    await sendNotificationToAllSubscribers(
                        `🔄 Task In Progress`,
                        `"${taskTitle}" is now in progress by ${assignedTo || 'team member'}`
                    );
                    notificationsSent++;
                    console.log(`Sent in-progress notification for: ${taskTitle}`);
                }
            }
        }

        console.log(`Sent ${notificationsSent} notifications`);

        // Clean up old state (remove tasks that no longer exist)
        const currentTaskIds = new Set(tasks.map(t => t.id || t.taskid || t.taskId || t.ID).filter(Boolean));
        for (const key of Object.keys(global._lastTaskState)) {
            const taskId = key.split('_')[0];
            if (!currentTaskIds.has(taskId)) {
                delete global._lastTaskState[key];
            }
        }

    } catch (error) {
        console.error('Error checking tasks:', error);
    }
}

// Send notification to all subscribers
async function sendNotificationToAllSubscribers(title, body) {
    const payload = JSON.stringify({
        title: title,
        body: body,
        url: '/',
        icon: '/icon-192.png',
        badge: '/badge-72.png',
        timestamp: Date.now()
    });

    const failedSubscriptions = [];

    for (const subscription of subscriptions) {
        try {
            await webPush.sendNotification(subscription, payload);
            console.log('Notification sent to:', subscription.endpoint.substring(0, 30) + '...');
        } catch (error) {
            console.error('Failed to send to subscription:', error.statusCode);
            if (error.statusCode === 410 || error.statusCode === 404) {
                // Subscription expired or invalid
                failedSubscriptions.push(subscription);
            }
        }
    }

    // Remove failed subscriptions
    if (failedSubscriptions.length > 0) {
        subscriptions = subscriptions.filter(sub => 
            !failedSubscriptions.some(failed => failed.endpoint === sub.endpoint)
        );
        console.log('Removed', failedSubscriptions.length, 'invalid subscriptions');
    }
}

// Export for testing
module.exports.checkForTaskUpdatesAndNotify = checkForTaskUpdatesAndNotify;
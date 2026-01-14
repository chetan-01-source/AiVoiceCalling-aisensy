/**
 * Routes Index
 * 
 * Aggregates all route modules
 */

const healthRoutes = require('./health.routes');
const webhookRoutes = require('./webhook.routes');

module.exports = {
    healthRoutes,
    webhookRoutes
};

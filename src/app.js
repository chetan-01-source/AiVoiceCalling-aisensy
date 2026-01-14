/**
 * Express Application Setup
 */

const express = require('express');
const path = require('path');

const { healthRoutes, webhookRoutes } = require('./routes');

const app = express();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Routes
app.use(healthRoutes);
app.use(webhookRoutes);

module.exports = app;

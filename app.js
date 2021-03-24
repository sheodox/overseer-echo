require('dotenv').config();
const express = require('express'),
    routes = require('./routes/index'),
    logger = require('morgan'),
    cors = require("cors"),
    app = express();

app.use(logger('dev'));

app.use(cors({
    origin: process.env.OVERSEER_HOST
}))

app.use('/', routes);

app.listen(3000, function() {
    console.log('listening on port 3000');
});

require('dotenv').config();
const express = require('express'),
    routes = require('./routes/index'),
    logger = require('morgan'),
    cors = require("cors"),
	port = process.env.ECHO_SERVER_PORT || 5002,
    app = express();

app.use(logger('dev'));

app.use(cors({
    origin: process.env.OVERSEER_HOST
}))

app.use('/', routes);

app.listen(port, function() {
    console.log(`listening on port ${port}`);
});

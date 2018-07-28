var express = require('express'),
    routes = require('./routes/index'),
    logger = require('morgan'),
    config = require('./config'),
    app = express();

app.use(logger('dev'));

app.use('/', routes);

app.listen(3000, function() {
    console.log('listening on port 3000');
});
module.exports = app;

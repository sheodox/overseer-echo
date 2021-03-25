require('dotenv').config();
const {OVERSEER_HTTPS_KEY_PATH, OVERSEER_HTTPS_CERT_PATH} = process.env,
    http = !!OVERSEER_HTTPS_CERT_PATH ? require('https') : require('http'),
    express = require('express'),
    fs = require('fs'),
    routes = require('./routes/index'),
    logger = require('morgan'),
    cors = require("cors"),
    app = express();

let server;
if (!!OVERSEER_HTTPS_CERT_PATH) {
    server = http.createServer({
        key: fs.readFileSync(OVERSEER_HTTPS_KEY_PATH),
        cert: fs.readFileSync(OVERSEER_HTTPS_CERT_PATH)
    }, app);
}
else {
    server = http.createServer(app);
}


app.use(logger('dev'));

app.use(cors({
    origin: process.env.OVERSEER_HOST
}))

app.use('/', routes);

server.listen(3000, function() {
    console.log('listening on port 3000');
});
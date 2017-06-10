var router = require('express').Router(),
    exec = require('child_process').exec,
    fs = require('fs'),
    path = require('path'),
    Busboy = require('busboy'),
    isPathInside = require('is-path-inside'),
    config = require('../config'),
    socket = require('socket.io-client').connect(config.overseer + '/echo-server'),
    storageDir = './storage';

socket.on('connect', sendList);
function sendList() {
    console.log('listing');
    //get list of available games
    fs.readdir(storageDir, function(err, files) {
        if (err) {
            files = [];
        }

        Promise.all([getUsedDisc(), statAll(files)])
            .then(([diskUsage, gamesList]) => {
                socket.emit('refresh', {
                    games: gamesList,
                    diskUsage
                });
            })
            .catch(err => console.log(err));
    });
}
socket.on('delete', function(game) {
    var gamepath = path.join(process.cwd(), storageDir, game + '.zip');
    if (isPathInside(gamepath, process.cwd())) {
        console.log(`deleting ${gamepath}`);
        fs.unlink(gamepath, err => {
            if (err) {
                console.log(err);
                socket.emit('error', err);
            }
            else {
                socket.emit('delete-game', game)
            }
        });
    }
    else {
        socket.emit('error', 'invalid game path');
    }
});

router.post('/upload', function(req, res) {
    console.log('got a request, eh');
    //forward games on to the backup server
    let busboy = Busboy({headers: req.headers}),
        gameName, details;

    busboy.on('file', function(fieldname, file, filename, encoding, mimetype) {
        console.log(`uploading ${filename}`);
        gameName = filename;
        const stream = new fs.createWriteStream(path.join(storageDir, filename));
        file.pipe(stream)
            .on('error', err => {
                console.log(err);
            });

        file.on('end', function() {
            res.send(true);
        });
    });

    busboy.on('field', function(fieldname, val) {
        if (fieldname === 'details') {
            details = val;
        }
    });

    busboy.on('finish', function() {
        console.log('done');
        statGame(gameName)()
            .then(gameData => {
                socket.emit('new-game', Object.assign(gameData, {
                    details: details
                }));
                console.log(gameName, gameData);
            })
    });

    req.pipe(busboy);
});

router.get('/download/:game', function(req, res) {
    console.log(req.params.game);
    socket.emit('downloaded', req.params.game.replace('.zip', ''));
    fs.createReadStream(path.join(storageDir, req.params.game)).pipe(res);
});

function getUsedDisc() {
    function getMeasurements(str) {
        const measurements = str.match(/(\d+)/g);
        return {
            total: measurements[0],
            used: measurements[1],
            free: measurements[2]
        }
    }

    return new Promise((resolve, reject) => {
        exec('df -B1', (err, stdout, stderr) => {
            if (err) {
                console.log(stderr);
                reject(err);
            }
            else {
                const driveInfo = stdout.split('\n').find(line => {
                    return line.indexOf(config.fsDevice) === 0;
                }).substr(config.fsDevice.length);

                console.log(driveInfo);
                console.log('measurements:');
                resolve(getMeasurements(driveInfo));
            }
        });
    });
}

function statAll(files) {
    var p = Promise.resolve(),
        games = [];

    for (var i = 0; i < files.length; i++) {
        p = p
            .then(statGame(files[i]))
            .then(stats => {
                console.log(stats);
                games.push(stats);
            });
    }

    return p.then(() => {
        return games});
}

function statGame(game) {
    return () => {
        return new Promise((resolve, reject) => {
            fs.stat(path.join(storageDir,  game), (err, stats) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve({
                        name: game.replace('.zip', ''),
                        size: stats.size,
                        modified: stats.mtime
                    })
                }
            })
        })
    }
}

//ensure there's a folder for games to be saved
try {
    fs.statSync(storageDir);
}
catch(e) {
    fs.mkdirSync(storageDir);
}

module.exports = router;

var router = require('express').Router(),
    exec = require('child_process').exec,
    fs = require('fs'),
    path = require('path'),
    Busboy = require('busboy'),
    isPathInside = require('is-path-inside'),
    config = require('../config'),
    socket = require('socket.io-client').connect(config.overseer + '/echo-server'),
    storageDir = config.storagePath || './storage';

socket.on('connect', sendList);
function sendList() {
    console.log('listing');
    //get list of available games
    fs.readdir(storageDir, function(err, files) {
        if (err) {
            files = [];
        }

        Promise.all([getUsedDisk(), statAll(files)])
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
    var gamepath = path.join(storageDir, game + '.zip');
    if (isPathInside(gamepath, storageDir)) {
        console.log(`deleting ${gamepath}`);
        fs.unlink(gamepath, err => {
            if (err) {
                console.log(err);
                socket.emit('error', err);
            }
            else {
                getUsedDisk()
                    .then(diskUsage => {
                        socket.emit('delete-game', {
                            diskUsage,
                            file: game
                        })
                    });
            }
        });
    }
    else {
        socket.emit('error', 'invalid game path');
    }
});

router.post('/upload', function(req, res) {
    //forward games on to the backup server
    let busboy = Busboy({headers: req.headers}),
        fields = {
            in_progress: true,
            size: 0,
            modified: new Date().toISOString()
        },
        gameName;

    busboy.on('file', function(fieldname, file, filename, encoding, mimetype) {
        console.log(`uploading ${filename}`);
        gameName = filename;
        const stream = new fs.createWriteStream(path.join(storageDir, filename));
        file.pipe(stream)
            .on('error', err => {
                console.log(err);
            });

        file.on('end', function() {
            Promise.all([getUsedDisk(), statGame(gameName)()])
                .then(([diskUsage, gameData]) => {
                    socket.emit('new-game', {
                        diskUsage,
                        game: Object.assign(fields, gameData, {
                            in_progress: false
                        })
                    });
                    console.log(gameName, gameData);
                });
            res.json({done: true});
        });
    });

    busboy.on('finish', function() {
        console.log('done');
    });

    req.pipe(busboy);
});

router.get('/download/:game', function(req, res) {
    console.log(req.params.game);
    socket.emit('downloaded', req.params.game.replace('.zip', ''));
    fs.createReadStream(path.join(storageDir, req.params.game)).pipe(res);
});

function getUsedDisk() {
    function getMeasurements(str) {
        const [total, used, free] = str.match(/\s+(\d+)\s+(\d+)\s+(\d+)/g);
        return {total, used, free};
    }

    return new Promise((resolve, reject) => {
        //get disk usage for the device the echo storage is on
        exec(`df -B1 ${config.storagePath}`, (err, stdout, stderr) => {
            if (err) {
                console.log(stderr);
                reject(err);
            }
            else {
                /* output will look something like this, get the last line:
                Filesystem      1K-blocks       Used  Available Use% Mounted on
                /dev/sda1      2883216560 1613121452 1123565624  59% /mnt/wdred
                 */
                const driveInfo = stdout.trim().split('\n')[1];

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
                        file: game.replace('.zip', ''),
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

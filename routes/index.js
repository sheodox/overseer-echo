var router = require('express').Router(),
    fs = require('fs'),
    path = require('path'),
    Busboy = require('busboy'),
    isPathInside = require('is-path-inside'),
    storageDir = './storage';

router.get('/list', function(req, res) {
    //get list of available games
    fs.readdir(storageDir, function(err, files) {
        if (err) {
            files = [];
        }

        statAll(files)
            .then(gamesInfo => {
                res.send(JSON.stringify(gamesInfo));
            })
            .catch(err => console.log(err));
    });
});

router.post('/upload', function(req, res) {
    console.log('got a request, eh');
    //forward games on to the backup server
    var busboy = Busboy({headers: req.headers});

    busboy.on('file', function(fieldname, file, filename, encoding, mimetype) {
        console.log(`uploading ${filename}`);
        var stream = new fs.createWriteStream(path.join(storageDir, filename));
        file.pipe(stream)
            .on('error', err => {
                console.log(err);
            });

        file.on('end', function() {
            res.send(true);
        });
    });

    busboy.on('finish', function() {
        console.log('done');
    });

    req.pipe(busboy);
});

router.get('/download/:game', function(req, res) {
    console.log(req.params.game);
    fs.createReadStream(path.join(storageDir, req.params.game + '.zip')).pipe(res);
});

router.get('/delete/:game', function(req, res) {
    var gamepath = path.join(process.cwd(), storageDir, req.params.game + '.zip');
    if (isPathInside(gamepath, process.cwd())) {
        console.log(`deleting ${gamepath}`);
        fs.unlink(gamepath, err => {
            if (err) {
                console.log(err);
                res.send(err);
            }
            else {
                res.send(true);
            }
        });
    }
    else {
        res.send('invalid path');
    }
});

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
                        game: game.replace('.zip', ''),
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

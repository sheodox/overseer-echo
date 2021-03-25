/**
 * Upload series of events:
 * 1. User submits item metadata on Overseer which is inserted to the DB and an ID is generated
 * 2. Overseer sends the ID to Echo to know to accept an upload with for it
 * 3. User posts a file upload to Echo with the agreed upon ID (without that ID the upload is rejected)
 * 4. Once the file is fully uploaded Echo sends a message to Overseer
 */

const router = require('express').Router(),
    exec = require('child_process').exec,
    fs = require('fs'),
    path = require('path'),
    Busboy = require('busboy'),
    socket = require('socket.io-client')(`${process.env.OVERSEER_HOST}/echo-server`, {
        auth: {
            token: process.env.OVERSEER_TOKEN
        }
    }),
    //Keep track of all of the IDs we have stored, so we can 404 without having to stat the file
    storedItemIds = new Set(),
    //For echo to accept an upload it needs to be made aware of an ID incoming from Overseer,
    //without an expected ID it will reject the upload. The ID is used as the file name here.
    expectedUploadIds = new Set(),
    storageDir = process.env.STORAGE_PATH || './storage',
    uuid = require('uuid'),
    // a really long timeout for requests so they don't get timed out
    REQUEST_TIMEOUT = 1000 * 60 * 60 * 10;

socket.on('connect', () => {
    console.log(`Connected to Overseer at ${new Date().toLocaleString()}`);
    refreshOverseer();
});

socket.on('expect-upload', (id, ack) => {
    console.log(`Told to expect an upload for ${id}`);
    //this eventually turns into a file name, ensure we only use predictable safe file paths by
    //only allowing UUIDs (though we should theoretically never get anything weird because it
    //comes from overseer itself, just in case!)
    if (uuid.validate(id)) {
        expectedUploadIds.add(id);
        //need to tell Overseer we're ready to accept the upload so the browser will post it
        ack();
    }
});

socket.on('delete', (id, done) => {
    //if for whatever reason we don't actually have this ID stored just say we've done it
    if (!storedItemIds.has(id)) {
        done();
        return;
    }

    if (uuid.validate(id)) {
        const itemPath = path.join(storageDir, id + '.zip');

        console.log(`deleting ${id}`);
        fs.unlink(itemPath, err => {
            if (err) {
                console.log(err);
            }
            else {
                done();
                refreshOverseer();
            }
        });
    }
});

async function refreshOverseer() {
    socket.emit('refresh', {
        diskUsage: await getUsedDisk()
    });
}

router.post('/upload/:id', function(req, res) {
    req.setTimeout(REQUEST_TIMEOUT);
    res.setTimeout(REQUEST_TIMEOUT);

    const busboy = Busboy({headers: req.headers}),
        id = req.params.id;

    if (!expectedUploadIds.has(id)) {
        res.status(412); //412 = Precondition Failed
        res.send();
        return;
    }
    expectedUploadIds.delete(id);

    busboy.on('file', function(fieldname, file, filename, encoding, mimetype) {
        console.log(`uploading ${filename}`);
        const stream = new fs.createWriteStream(path.join(storageDir, `${id}.zip`));

        file.pipe(stream)
            .on('error', err => {
                console.log(err);
            });

        file.on('end', async () => {
            const size = await statUpload(id);
            socket.emit('uploaded', id, {
                size
            });

            storedItemIds.add(id);
            res.send();
        });
    });

    busboy.on('finish', function() {
        console.log('done');
    });

    req.pipe(busboy);
});

router.get('/download/:id', function(req, res) {
    req.setTimeout(REQUEST_TIMEOUT);
    res.setTimeout(REQUEST_TIMEOUT);
    const id = req.params.id,
        token = req.query.token;

    // before trying anything, make sure there's actually something here.
    // this should probably never happen, but just extra precaution!
    if (!storedItemIds.has(id)) {
        res.status(404);
        res.send(`Error 404: Nothing stored with that identifier.`)
        return;
    }

    //Downloads will only be served to users who present a download token, a JWT generated
    //by Overseer, we need to verify the token with Overseer before serving the file.
    //Additionally Overseer will also give us the name of the item so the file can be
    //downloaded with a file name that's not just an ugly UUID.
    socket.emit('verify-download-token', token, id, ({allowed, name}) => {
        if (allowed) {
            socket.emit('downloaded', id);
            res.set('Content-Disposition',  `attachment; filename="${name}.zip"`)
            fs.createReadStream(path.join(storageDir, `${id}.zip`)).pipe(res);
        }
        else {
            res.status(401)
            res.send(`Error 401: You don't have permission to download that!`);
        }
    })
});

function getUsedDisk() {
    function getMeasurements(str) {
        const [_, total, used, free] = str.match(/\s+(\d+)\s+(\d+)\s+(\d+)/);
        return {total, used, free};
    }

    return new Promise((resolve, reject) => {
        //get disk usage for the device the echo storage is on
        exec(`df -B1 ${storageDir}`, (err, stdout, stderr) => {
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

                resolve(getMeasurements(driveInfo));
            }
        });
    });
}

function statUpload(uploadId) {
    return new Promise((resolve, reject) => {
        fs.stat(path.join(storageDir,  `${uploadId}.zip`), (err, stats) => {
            if (err) {
                reject(err);
            }
            else {
                resolve(stats.size);
            }
        })
    })
}

//ensure there's a folder for games to be saved
try {
    fs.statSync(storageDir);
}
catch(e) {
    fs.mkdirSync(storageDir);
}

fs.readdirSync(storageDir).forEach(file => {
    const id = path.basename(file, '.zip');
    if (uuid.validate(id)) {
        storedItemIds.add(id);
    }
})

module.exports = router;

const { google } = require('googleapis');
const OAuth2 = google.auth.OAuth2;
const drive = google.drive('v3');

const { Storage } = require('@google-cloud/storage');
const storage = new Storage();
const myBucket = storage.bucket('gospel-crowd-salon-app-test-bucket');

const admin = require('firebase-admin');
admin.initializeApp();
var db = admin.firestore();

const functions = require('firebase-functions');

const googleCredentials = require('./credentials.json');

db.settings({
    ignoreUndefinedProperties: true,
})

function transferFileToStorage(request, response) {
    console.log(`File ID to Transfer: ${request.body.fileId}`);

    drive.files
        .get({ fileId: request.body.fileId, alt: 'media' }, { responseType: 'stream' })
        .then(getres => {
            return new Promise((resolve, reject) => {
                let progress = 0;
                const storageFile = myBucket.file(request.body.fileId);

                getres.data
                    .on('end', () => {
                        console.log('Done downloading file.');
                    })
                    .on('error', geterr => {
                        console.error('Error downloading file.');
                        reject(geterr);
                    })
                    .on('data', d => {
                        progress += d.length;
                        if (process.stdout.isTTY) {
                            process.stdout.clearLine();
                            process.stdout.cursorTo(0);
                            process.stdout.write(`Downloaded ${progress} bytes`);
                            console.log(`Downloaded ${progress} bytes`);
                        }
                    })
                    .pipe(storageFile.createWriteStream())
                    .on('finish', () => {
                        storageFile.download()
                            .then(function (data) {
                                console.log(`Uploaded ${request.body.fileId} to Cloud Storage.`);
                                response.sendStatus(200);
                            })
                            .catch(error => {
                                console.error(error);
                                response.sendStatus(500);
                            });
                    });
            });
        });
}

function syncFiles(request, response) {
    drive.files.list({
        q: "mimeType contains 'video/'",
        pageSize: 1000,
        fields: 'nextPageToken, files(id, name)',
    }, (err, res) => {
        if (err) return console.log('The API returned an error: ' + err);

        console.log('Current signed in user:' + request.body.userMailId);

        var files = res.data.files;
        if (files.length) {
            var fileMetadata = files.map((driveFile) => {
                // console.log(`File: ${driveFile.name} (${driveFile.id})`);

                return {
                    fileName: driveFile.name,
                    fileId: driveFile.id,
                    origin: 'drive'
                };
            })

            let fileMetadataPromises = fileMetadata.map(async (elem) => {
                const getres = await drive.files.get({
                    fileId: elem.fileId,
                    fields: 'thumbnailLink'
                });
                // if (geterr) return console.log('The API returned an error: ' + geterr);
                if (getres.data.thumbnailLink != null) {
                    console.log(`Thumbnail Url: ${getres.data.thumbnailLink}`);
                    elem.thumbnailUrl = getres.data.thumbnailLink;
                }
                return elem;
            })

            Promise.all(fileMetadataPromises)
            .then((values) => {
                console.log(`fileMetadata: ${JSON.stringify(values)}`);

                db.collection('users')
                .doc(request.body.userMailId)
                .update({
                    discoveryData: {
                        files: values
                    }
                })
                .then(() => response.sendStatus(200));
            })
            
            // Promise.all(fileMetadata)
            //     .then((allerr, allres) => {
            //         console.log(`fileMetadata: ${allres}`);
            //     })
        }
    });
}

const runtimeOpts = {
    timeoutSeconds: 540,
    memory: '4GB'
}

exports.driveTransfer = functions
    .runWith(runtimeOpts)
    .https
    .onRequest((request, response) => {
        const oAuth2Client = new OAuth2(
            googleCredentials.web.client_id,
            googleCredentials.web.client_secret,
            googleCredentials.web.redirect_uris[0]
        );

        console.log('access token: ' + request.body.accessToken);

        oAuth2Client.setCredentials({
            access_token: request.body.accessToken
        });

        google.options({ auth: oAuth2Client });

        transferFileToStorage(request, response);
    });

exports.driveDiscovery = functions
    .https
    .onRequest((request, response) => {
        const oAuth2Client = new OAuth2(
            googleCredentials.web.client_id,
            googleCredentials.web.client_secret,
            googleCredentials.web.redirect_uris[0]
        );

        console.log('access token: ' + request.body.accessToken);

        oAuth2Client.setCredentials({
            access_token: request.body.accessToken
        });

        google.options({ auth: oAuth2Client });

        syncFiles(request, response);
    })
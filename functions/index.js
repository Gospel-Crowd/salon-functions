const { google } = require('googleapis');
const OAuth2 = google.auth.OAuth2;
const drive = google.drive('v3');
const functions = require('firebase-functions');

const googleCredentials = require('./credentials.json');

function listFiles() {
    drive.files.list({
        q: "mimeType='image/jpeg'",
        pageSize: 10,
        fields: 'nextPageToken, files(id, name)',
    }, (err, res) => {
        if (err) return console.log('The API returned an error: ' + err);
        const files = res.data.files;
        if (files.length) {
            console.log('Files:');
            files.map((file) => {
                console.log(`${file.name} (${file.id})`);
            });
        } else {
            console.log('No files found.');
        }
    });
}

exports.driveTransfer = functions.https.onRequest((request, response) => {
    const oAuth2Client = new OAuth2(
        googleCredentials.web.client_id,
        googleCredentials.web.client_secret,
        googleCredentials.web.redirect_uris[0]
    );

    oAuth2Client.setCredentials({
        refresh_token: googleCredentials.refresh_token
    });

    google.options({auth: oAuth2Client});

    listFiles();
});

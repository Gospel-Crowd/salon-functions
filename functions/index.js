require("date-utils");

const { google } = require('googleapis');
const { Storage } = require('@google-cloud/storage');

const admin = require('firebase-admin');
const functions = require('firebase-functions');
const googleCredentials = require('./credentials.json');
const mailer = require("nodemailer");
const Puid = require("puid");

// Initialize Firebase App
admin.initializeApp();

// Initialize DB
var db = admin.firestore();
db.settings({
    ignoreUndefinedProperties: true,
})

// Initialize Storage
const drive = google.drive('v3');
const storage = new Storage();
const myBucket = storage.bucket('gospel-crowd-salon-app-test-bucket');

// Initialize Auth
const OAuth2 = google.auth.OAuth2;

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

exports.driveTransfer = functions
    .runWith({
        timeoutSeconds: 540,
        memory: '4GB'
    })
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

exports.sendSalonRegistrationThanksMail = functions.https.onCall((data, res) => {
    const puid = new Puid();
    const generateID = puid.generate().slice(0, 4).toUpperCase();
    const date = new Date().toFormat("YYYY年MM月DD日");

    const mailBody = `
      ※このメールはシステムからの自動送信です
      ${data.fullName} 様
      お世話になっております。
      この度は、Gospel Crowdへのサロン開講申請をして頂きありがとうございます。
      以下の内容でご登録申請を受け付けいたしました。
      ●営業日以内に、担当者よりご連絡いたしますので今しばらくお待ちくださいませ。
    
      ━━━━━━□■□ ご申請内容 □■□━━━━━━
    
      お名前： ${data.fullName}
    
      お電話番号： ${data.phoneNumber}
    
      E-Mail： ${data.mail}
    
      お問い合わせ日時： ${date}
    
      お問い合わせ番号： ${generateID}
    
      お問い合わせ内容： ${data.text}
    
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
      ご質問や、不明点などがあれば以下の連絡先までご連絡ください。
    
      ━━━━━━□■□ 連絡先 □■□━━━━━━━━━
    
      お問い合わせ先： gospel.crowd@gmail.com
    
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      `;

    return mailer.createTransport({
        service: "gmail",
        auth: {
            user: functions.config().gmail.id,
            pass: functions.config().gmail.key,
        },
    }).sendMail({
        from: "Gospel Crowd <gospel.crowd@gmail.com>",
        to: `${data.mail}, gospel.crowd@gmail.com`,
        subject: '新しいサロン登録リクエスト',
        text: mailBody,
        bcc: "samuel.anudeep@gmail.com",
    }, (err, info) => {
        if (err) {
            return console.log(err);
        }
        return console.log("success");
    });
});

exports.sendFeedbackMailToGospelCrowd = functions.https.onCall((data, res) => {
    const mailBody = `
      ※このメールはシステムからの自動送信です
      
      お客様から以下のフィードバックが届きました。
    
      ━━━━━━□■□ お問い合わせ内容 □■□━━━━━━
    
      お名前： ${data.name}
    
      メールアドレス： ${data.mail}
    
      お問い合わせカテゴリー： ${data.category}

      お問い合わせ内容： ${data.content}
    
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      `;

    return mailer.createTransport({
        service: "gmail",
        auth: {
            user: functions.config().gmail.id,
            pass: functions.config().gmail.key,
        },
    }).sendMail({
        from: "Gospel Crowd <gospel.crowd@gmail.com>",
        to: 'gospel.crowd@gmail.com',
        subject: 'アプリから新しいフィードバックをもらいました',
        text: mailBody,
        bcc: "samuel.anudeep@gmail.com",
    }, (err, info) => {
        if (err) {
            return console.log(err);
        }
        return console.log("Successfully sent feedback mail to Gospel Crowd");
    });
});


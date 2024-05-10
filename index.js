const { google } = require('googleapis');
const express = require('express');
const stream = require('stream');
const multer = require('multer');
const fs = require('fs');
const axios = require('axios');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// Path to your service account key file
const GCLOUD_KEYFILEPATH = 'key.json'; // gCloud credentials
const DRIVE_ID = "0AO9Ycf7pIQxoUk9PVA"; // NeckoLogs
const BUGZILLA_API_KEY = ""; // put your bot's key here

// Read credentials from the key file
const credentials = JSON.parse(fs.readFileSync(GCLOUD_KEYFILEPATH, 'utf8'));

// todo:
// * read in driveId from Env
// * sometimes a deleted folder (not fully deleted) is found and used as drop location

// Initialize the auth client
const auth = new google.auth.GoogleAuth({
    credentials: credentials,
    scopes: ['https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/drive.file'
    ]
});
const drive = google.drive({ version: 'v3', auth });

// returns the id of the folder if it exists
async function getFolderId(name) {
  const response = await drive.files.list({
      //pageSize: 10, // Number of files to list
      driveId: DRIVE_ID, // Replace with your shared drive ID
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      corpora: 'drive', // This ensures the listing is specific to the shared drive
      q: `mimeType='application/vnd.google-apps.folder'`,
      fields: 'files(id, name)',
  });

  const files = response.data.files;
  console.log("Folder count: " + files.length);
  if (files.length) {
    for (let file of files) {
      // console.log(`${file.name} (${file.id})`);
      if (file.name == name) {
        return file.id; 
      }
    }
  } 
  console.log('No folder by that name.');
  return "";
}

async function createFolder(name) {
  // no need to create folder if it already exists
  let folderId = await getFolderId(name);
  if (folderId != "") {
    console.log("Folder already exist");
    return folderId; 
  }
  
  const folderMetadata = {
      name: name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [DRIVE_ID]
  };
  const folder = await drive.files.create({
    supportsTeamDrives: true,
      driveId: DRIVE_ID, // Replace with your shared drive ID
      resource: folderMetadata,
      fields: 'id'
  });
  return folder.data.id;
}

async function createBugzillaComment(bugId) {
  const url = `https://bugzilla.mozilla.org/rest/bug/${bugId}/comment`;
  const data = {
    "comment": "IAmAnAutomatedComment",
  };
  const headers = {
    'X-BUGZILLA-API-KEY': BUGZILLA_API_KEY
  };

  axios.post(url, data, {
    headers: headers
  })
  .then(response => {
    console.log('Response:', response.data);
  })
  .catch(error => {
    console.error('Error:', error);
  });
}

async function createFile(filename, folder) {
    const fileMetadata = {
        name: filename,
        parents: [folder]
    };
    
    const file = await drive.files.create({
      supportsTeamDrives: true,
        driveId: DRIVE_ID, // Replace with your shared drive ID
        resource: fileMetadata,
        fields: 'id'
    });
    
    console.log('File ID: ', file.data.id);
}

// Serve the HTML file for uploads
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/upload.html');
});

async function checkBugIdExists(bugId) {
  const url = `https://bugzilla.mozilla.org/rest/bug/${bugId}`;
  const headers = {
    'X-BUGZILLA-API-KEY': BUGZILLA_API_KEY
  };

  try {
    await axios.get(url, { headers })
  }
  catch {
    return { error: true, message: "Bug number does not appear to exist" }
  }
  return { error: false }
}

// Endpoint to handle file uploads
app.post('/upload', upload.single('file'), async (req, res) => {
  if (req.file) {
      try {
        // check that bugzilla bug exists
        let maybeError = await checkBugIdExists(req.body.bugid);
        if (maybeError.error) {
          let errString = 'Failed to upload file: '.concat(maybeError.message);
          console.log(errString);
          res.send(errString);
          return;
        }

        // create the gDrive folder (if needed) for our bug
        console.log(`creating folder ${req.body.bugid}`);
        let folder = await createFolder(`${req.body.bugid}`);
        console.log("Folder: " + folder);
        const bufferStream = new stream.PassThrough();
        bufferStream.end(Buffer.from(req.file.buffer));

        // upload the file to the new folder
        let media = {
            mimeType: req.file.mimetype,
            body: bufferStream
        }
        const fileMetadata = {
            name: req.file.originalname,
            parents: [folder]
        };
        const file = await drive.files.create({
          supportsTeamDrives: true,
            driveId: DRIVE_ID, // Replace with your shared drive ID
            resource: fileMetadata,
            fields: 'id',
            media: media
        });
        console.log('Uploaded File ID: ', file.data.id);
        res.send(`File uploaded as ${file.data.id}`);

        // update bugzilla with comment
        createBugzillaComment(req.body.bugid);
      } catch (error) {
        console.error('Error uploading file:', error);
        res.status(500).send('Error uploading file');
      }
  } else {
      res.status(400).send('No file uploaded');
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

async function listFiles() {
    try {
        const response = await drive.files.list({
            // pageSize: 10, // Number of files to list
            fields: 'nextPageToken, files(id, name)',
            driveId: DRIVE_ID, // Replace with your shared drive ID
            includeItemsFromAllDrives: true,
            supportsAllDrives: true,
            corpora: 'drive' // This ensures the listing is specific to the shared drive
        });

        const files = response.data.files;
        if (files.length) {
            console.log('Files:');
            files.forEach(file => {
                console.log(`${file.name} (${file.id})`);
            });
        } else {
            console.log('No files found.');
        }
    } catch (error) {
        console.error('The API returned an error: ', error);
    }
}
// listFiles();


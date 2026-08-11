const express = require('express');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// --- CONFIGURATION ---
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const BUCKET_NAME = 'uploads';
const API_KEY = process.env.UPLOAD_KEY || 'dev-only-key';

// Initialize Supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Configure Multer to store file in memory
const upload = multer({ storage: multer.memoryStorage() });

// --- MIDDLEWARE ---
const authenticateUpload = (req, res, next) => {
  if (req.headers['x-api-key'] !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized: Invalid API Key' });
  }
  next();
};

// --- API ROUTES ---

// 1. Endpoint to receive files from PowerShell
app.post('/upload', authenticateUpload, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received' });

  const fileName = `${Date.now()}-${req.file.originalname.replace(/\s+/g, '_')}`;
  
  try {
    const { data, error } = await supabase
      .storage
      .from(BUCKET_NAME)
      .upload(fileName, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false
      });

    if (error) throw error;
    
    res.json({ ok: true, filename: fileName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Endpoint to list files for the web UI
app.get('/api/files', async (req, res) => {
  try {
    const { data, error } = await supabase.storage.from(BUCKET_NAME).list();
    if (error) throw error;

    const sortedFiles = data.reverse();

    const fileData = sortedFiles
      .filter(file => file.name !== '.emptyFolderPlaceholder')
      .map(file => {
        const { data: urlData } = supabase.storage.from(BUCKET_NAME).getPublicUrl(file.name);
        return {
          name: file.name,
          url: urlData.publicUrl
        };
      });

    res.json(fileData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- FRONTEND (HTML UI) ---
app.get('/', (req, res) => {
  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>File Repository</title>
        <style>
            body { font-family: Arial, sans-serif; background: #f4f4f9; padding: 20px; }
            .container { max-width: 800px; margin: auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            h1 { color: #333; text-align: center; }
            .file-card { border: 1px solid #ddd; padding: 15px; margin-bottom: 10px; border-radius: 5px; display: flex; justify-content: space-between; align-items: center; }
            .file-info strong { font-size: 16px; color: #0056b3; }
            .btn { padding: 8px 15px; text-decoration: none; border-radius: 4px; color: white; font-size: 14px; margin-left: 5px; }
            .btn-preview { background: #6c757d; }
            .btn-download { background: #007bff; }
            .empty { text-align: center; color: #777; margin-top: 30px; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>Shared Files</h1>
            <div id="fileList"><p class="empty">Loading files...</p></div>
        </div>

        <script>
            async function loadFiles() {
                try {
                    const response = await fetch('/api/files');
                    if (!response.ok) throw new Error('Network response was not ok');
                    const files = await response.json();
                    const fileList = document.getElementById('fileList');
                    
                    if (files.length === 0) {
                        fileList.innerHTML = '<p class="empty">No files uploaded yet.</p>';
                        return;
                    }

                    fileList.innerHTML = files.map(file => 
                        '<div class="file-card">' +
                            '<div class="file-info">' +
                                '<strong>' + file.name + '</strong>' +
                            '</div>' +
                            '<div class="actions">' +
                                '<a href="' + file.url + '" target="_blank" class="btn btn-preview">Preview</a>' +
                                '<a href="' + file.url + '" download="' + file.name + '" class="btn btn-download">Download</a>' +
                            '</div>' +
                        '</div>'
                    ).join('');
                } catch (error) {
                    document.getElementById('fileList').innerHTML = '<p class="empty">Error loading files. Check if Supabase keys are set in Render.</p>';
                }
            }
            loadFiles();
        </script>
    </body>
    </html>
  `;
  
  res.send(html);
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

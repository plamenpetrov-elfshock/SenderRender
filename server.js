const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();

// --- CONFIGURATION ---
// Use the Render Persistent Disk mount path, or a local 'uploads' folder for testing
const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const API_KEY = process.env.UPLOAD_KEY || 'dev-only-key'; 

// Ensure the upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Configure Multer (File upload engine)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    // Add timestamp to prevent overwriting files with the same name
    const uniqueSuffix = Date.now() + '-';
    cb(null, uniqueSuffix + file.originalname);
  }
});
const upload = multer({ storage });

// --- MIDDLEWARE ---
// Authentication middleware for the upload endpoint
const authenticateUpload = (req, res, next) => {
  if (req.headers['x-api-key'] !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized: Invalid API Key' });
  }
  next();
};

// --- API ROUTES ---

// 1. Endpoint to receive files from PowerShell
app.post('/upload', authenticateUpload, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received' });
  res.json({ 
    ok: true, 
    filename: req.file.filename,
    size: req.file.size
  });
});

// 2. Endpoint to list files for the web UI
app.get('/api/files', (req, res) => {
  fs.readdir(UPLOAD_DIR, (err, files) => {
    if (err) return res.status(500).json({ error: 'Cannot read directory' });
    
    const fileData = files.map(name => {
      const stats = fs.statSync(path.join(UPLOAD_DIR, name));
      return {
        name,
        size: (stats.size / 1024).toFixed(2) + ' KB', // Convert to KB
        uploadDate: stats.mtime
      };
    });
    
    // Sort newest first
    fileData.sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate));
    res.json(fileData);
  });
});

// 3. Endpoint to download a file
app.get('/download/:filename', (req, res) => {
  const safeFilename = path.basename(req.params.filename); // Prevent path traversal attacks
  const filePath = path.join(UPLOAD_DIR, safeFilename);
  
  if (!fs.existsSync(filePath)) return res.status(404).send('File not found');
  res.download(filePath);
});

// 4. Endpoint to preview a file inline (images, PDFs, text)
app.get('/preview/:filename', (req, res) => {
  const safeFilename = path.basename(req.params.filename);
  const filePath = path.join(UPLOAD_DIR, safeFilename);
  
  if (!fs.existsSync(filePath)) return res.status(404).send('File not found');
  res.sendFile(filePath);
});

// --- FRONTEND (HTML UI) ---
app.get('/', (req, res) => {
  res.send(`
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
            .file-info small { color: #666; display: block; margin-top: 5px; }
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
                    const files = await response.json();
                    const fileList = document.getElementById('fileList');
                    
                    if (files.length === 0) {
                        fileList.innerHTML = '<p class="empty">No files uploaded yet.</p>';
                        return;
                    }

                    fileList.innerHTML = files.map(file => \`
                        <div class="file-card">
                            <div class="file-info">
                                <strong>\${file.name}</strong>
                                <small>Size: \${file.size} | Uploaded: \${new Date(file.uploadDate).toLocaleString()}</small>
                            </div>
                            <div class="actions">
                                <a href="/preview/\${file.name}" target="_blank" class="btn btn-preview">Preview</a>
                                <a href="/download/\${file.name}" class="btn btn-download">Download</a>
                            </div>
                        </div>
                    \`).join('');
                } catch (error) {
                    document.getElementById('fileList').innerHTML = '<p class="empty">Error loading files.</p>';
                }
            }
            loadFiles();
        </script>
    </body>
    </html>
  `);
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(\`Server running on port \${PORT}\`));
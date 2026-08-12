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

// Need this to parse JSON bodies for bulk delete
app.use(express.json());

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
    const { data, error } = await supabase.storage.from(BUCKET_NAME).list('', { limit: 1000, offset: 0 });
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

// 3. Endpoint to DELETE a single file
app.delete('/api/files/:filename', async (req, res) => {
  try {
    const fileName = decodeURIComponent(req.params.filename);
    const { error } = await supabase.storage.from(BUCKET_NAME).remove([fileName]);
    
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Endpoint to DELETE multiple files (Bulk)
app.post('/api/files/bulk-delete', async (req, res) => {
  try {
    const { filenames } = req.body;
    if (!Array.isArray(filenames)) return res.status(400).json({ error: 'Invalid payload' });

    const { error } = await supabase.storage.from(BUCKET_NAME).remove(filenames);
    if (error) throw error;
    
    res.json({ ok: true });
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
            .header { display: flex; align-items: center; justify-content: center; margin-bottom: 20px; }
            h1 { color: #333; margin: 0; }
            .badge { background-color: #007bff; color: white; padding: 5px 12px; border-radius: 15px; font-size: 14px; margin-left: 15px; }
            .toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid #ddd; }
            .toolbar-left { display: flex; align-items: center; gap: 10px; }
            .toolbar-actions button { margin-left: 5px; }
            .file-card { border: 1px solid #ddd; padding: 15px; margin-bottom: 10px; border-radius: 5px; display: flex; justify-content: space-between; align-items: center; animation: fadeIn 0.5s ease-in-out; }
            .file-info { display: flex; align-items: center; gap: 10px; }
            .file-info strong { font-size: 16px; color: #0056b3; word-break: break-all; }
            .btn { padding: 8px 15px; text-decoration: none; border-radius: 4px; color: white; font-size: 14px; margin-left: 5px; border: none; cursor: pointer; }
            .btn-preview { background: #6c757d; }
            .btn-download { background: #007bff; }
            .btn-delete { background: #dc3545; }
            .btn-bulk-delete { background: #dc3545; }
            .btn-bulk-download { background: #28a745; }
            .empty { text-align: center; color: #777; margin-top: 30px; }
            @keyframes fadeIn { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>Shared Files</h1>
                <span id="fileCount" class="badge">0 files</span>
            </div>
            
            <div class="toolbar">
                <div class="toolbar-left">
                    <input type="checkbox" id="selectAll" onchange="toggleSelectAll(this)">
                    <label for="selectAll">Select All</label>
                </div>
                <div class="toolbar-actions">
                    <button class="btn btn-bulk-download" onclick="bulkDownload()">Download Selected</button>
                    <button class="btn btn-bulk-delete" onclick="bulkDelete()">Delete Selected</button>
                </div>
            </div>

            <div id="fileList"><p class="empty">Loading files...</p></div>
        </div>

        <script>
            let currentFiles = [];

            // Helper to update the counter badge
            function updateFileCount(count) {
                document.getElementById('fileCount').innerText = count + (count === 1 ? ' file' : ' files');
            }

            async function checkForUpdates() {
                try {
                    const response = await fetch('/api/files');
                    if (!response.ok) return;
                    const files = await response.json();

                    // Check if the list has changed before re-rendering to preserve checkbox states
                    const newFileNames = files.map(f => f.name).join(',');
                    const oldFileNames = currentFiles.map(f => f.name).join(',');

                    if (newFileNames !== oldFileNames) {
                        // Save currently checked items before re-rendering
                        let checkedFilenames = new Set();
                        document.querySelectorAll('.file-checkbox:checked').forEach(cb => {
                            checkedFilenames.add(cb.value);
                        });

                        currentFiles = files;
                        renderFiles(files);

                        // Restore checked items
                        document.querySelectorAll('.file-checkbox').forEach(cb => {
                            if (checkedFilenames.has(cb.value)) {
                                cb.checked = true;
                            }
                        });
                    }
                } catch (e) {
                    // Silently fail to avoid spamming console if network drops momentarily
                }
            }

            function renderFiles(files) {
                const fileList = document.getElementById('fileList');
                updateFileCount(files.length);

                if (files.length === 0) {
                    fileList.innerHTML = '<p class="empty">No files uploaded yet.</p>';
                    return;
                }

                fileList.innerHTML = files.map(file => 
                    '<div class="file-card" id="card-' + encodeURIComponent(file.name) + '">' +
                        '<div class="file-info">' +
                            '<input type="checkbox" class="file-checkbox" value="' + file.name + '" data-url="' + file.url + '">' +
                            '<strong>' + file.name + '</strong>' +
                        '</div>' +
                        '<div class="actions">' +
                            '<a href="' + file.url + '" target="_blank" class="btn btn-preview">Preview</a>' +
                            '<a href="' + file.url + '" download="' + file.name + '" class="btn btn-download">Download</a>' +
                            '<button class="btn btn-delete" onclick="deleteFile(\\'' + file.name + '\\')">Delete</button>' +
                        '</div>' +
                    '</div>'
                ).join('');
            }

            function toggleSelectAll(source) {
                const checkboxes = document.querySelectorAll('.file-checkbox');
                checkboxes.forEach(cb => cb.checked = source.checked);
            }

            function getSelectedFiles() {
                const checkboxes = document.querySelectorAll('.file-checkbox:checked');
                return Array.from(checkboxes);
            }

            // Recount visible files in the DOM
            function recountVisibleFiles() {
                const visibleCards = document.querySelectorAll('.file-card').length;
                updateFileCount(visibleCards);
            }

            async function deleteFile(fileName) {
                if (!confirm('Are you sure you want to delete ' + fileName + '?')) return;
                
                try {
                    const response = await fetch('/api/files/' + encodeURIComponent(fileName), { method: 'DELETE' });
                    if (response.ok) {
                        const card = document.getElementById('card-' + encodeURIComponent(fileName));
                        if (card) card.remove();
                        recountVisibleFiles();
                        checkForUpdates(); // Immediately sync with server
                    } else {
                        alert('Failed to delete file.');
                    }
                } catch (error) {
                    alert('Error: ' + error.message);
                }
            }

            async function bulkDelete() {
                const selected = getSelectedFiles();
                if (selected.length === 0) return alert('Please select at least one file to delete.');
                if (!confirm('Delete ' + selected.length + ' selected files?')) return;

                const filenames = selected.map(cb => cb.value);
                
                try {
                    const response = await fetch('/api/files/bulk-delete', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ filenames: filenames })
                    });

                    if (response.ok) {
                        selected.forEach(cb => {
                            const card = document.getElementById('card-' + encodeURIComponent(cb.value));
                            if (card) card.remove();
                        });
                        document.getElementById('selectAll').checked = false;
                        recountVisibleFiles();
                        checkForUpdates(); // Immediately sync with server
                    } else {
                        alert('Failed to delete files.');
                    }
                } catch (error) {
                    alert('Error: ' + error.message);
                }
            }

            function bulkDownload() {
                const selected = getSelectedFiles();
                if (selected.length === 0) return alert('Please select at least one file to download.');

                selected.forEach((cb, index) => {
                    setTimeout(() => {
                        const url = cb.dataset.url;
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = cb.value;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                    }, index * 300);
                });
            }

            // Initial load
            checkForUpdates();
            // Set polling interval to every 3 seconds
            setInterval(checkForUpdates, 3000);
        </script>
    </body>
    </html>
  `;
  
  res.send(html);
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

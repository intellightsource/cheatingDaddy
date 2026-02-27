const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'src');
const PORT = Number(process.env.PORT) || 5173;
const MAX_PORT_ATTEMPTS = 20;

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
};

function send(res, statusCode, headers, body) {
    res.writeHead(statusCode, headers);
    res.end(body);
}

function resolvePath(urlPath) {
    const cleanPath = decodeURIComponent(urlPath.split('?')[0]);
    const requested = cleanPath === '/' ? '/browser.html' : cleanPath;
    const fullPath = path.normalize(path.join(ROOT, requested));
    if (!fullPath.startsWith(ROOT)) {
        return null;
    }
    return fullPath;
}

function serveFile(filePath, res) {
    fs.readFile(filePath, (readErr, data) => {
        if (readErr) {
            send(res, 500, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Internal Server Error');
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        send(res, 200, { 'Content-Type': contentType }, data);
    });
}

function handleRequest(req, res) {
    const targetPath = resolvePath(req.url || '/');
    if (!targetPath) {
        send(res, 403, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Forbidden');
        return;
    }

    fs.stat(targetPath, (statErr, stat) => {
        if (statErr) {
            send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not Found');
            return;
        }

        if (stat.isDirectory()) {
            const indexPath = path.join(targetPath, 'browser.html');
            fs.stat(indexPath, (indexErr, indexStat) => {
                if (indexErr || !indexStat.isFile()) {
                    send(res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not Found');
                    return;
                }
                serveFile(indexPath, res);
            });
            return;
        }

        serveFile(targetPath, res);
    });
}

function startServer(port, attemptsLeft) {
    const server = http.createServer(handleRequest);

    server.on('error', error => {
        if (error.code === 'EADDRINUSE' && attemptsLeft > 0) {
            const nextPort = port + 1;
            console.warn(`Port ${port} is in use. Retrying on ${nextPort}...`);
            startServer(nextPort, attemptsLeft - 1);
            return;
        }

        console.error(`Failed to start web server on port ${port}:`, error.message);
        process.exit(1);
    });

    server.listen(port, () => {
        console.log(`Web build running at http://localhost:${port}`);
        console.log(`Serving directory: ${ROOT}`);
    });
}

startServer(PORT, MAX_PORT_ATTEMPTS);

// Patches server.js inside the Docker image to serve the React frontend.
// Inserts both express.static and the catch-all route right after the app
// is created, so they take precedence over the JSON 404 fallback later in
// the file.
var fs = require('fs');
var path = '/app/backend/server.js';
var c = fs.readFileSync(path, 'utf8');
if (c.indexOf('FRONTEND_SERVE_INJECTED') === -1) {
  var insertBlock = [
    "// FRONTEND_SERVE_INJECTED",
    "var __pathMod = require('path');",
    "var __frontendBuild = __pathMod.join(__dirname, '..', 'frontend', 'build');",
    "app.use(require('express').static(__frontendBuild));",
    "app.get(/^\\/(?!api).*/, function(req, res, next) {",
    "  res.sendFile(__pathMod.join(__frontendBuild, 'index.html'));",
    "});",
    ""
  ].join('\n');
  // Insert right after the first `const app = express();` line
  c = c.replace(/const app = express\(\);[\r\n]+/, function(m) { return m + insertBlock; });
  // Remove the old express.static line if it was previously inserted on its own
  c = c.replace(/app\.use\(require\('express'\)\.static\(require\('path'\)\.join\(__dirname,'\.\.\/frontend\/build'\)\)\);\n/g, '');
  // Remove the old app.get('*',...) line that we previously injected
  c = c.replace(/app\.get\('\*',function\(req,res,next\)\{if\(req\.path\.startsWith\('\/api'\)\)return next\(\);require\('path'\);res\.sendFile\(require\('path'\)\.join\(__dirname,'\.\.\/frontend\/build\/index\.html'\)\)\;\}\);/g, '');
  fs.writeFileSync(path, c);
  console.log('server.js patched for frontend serving');
} else {
  console.log('server.js already patched');
}

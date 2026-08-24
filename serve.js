/* Preprost statični strežnik brez odvisnosti — za preizkus na telefonu prek WiFi.
   Zagon: node serve.js  (privzeto vrata 8080) */
var http = require('http'), fs = require('fs'), path = require('path'), os = require('os');

var PORT = process.env.PORT || 8080;
var ROOT = __dirname;
var TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png'
};

http.createServer(function (req, res) {
  var rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  var file = path.join(ROOT, path.normalize(rel).replace(/^([.][.][/\\])+/, ''));
  if (file.indexOf(ROOT) !== 0) { res.writeHead(403).end('Prepovedano'); return; }

  fs.readFile(file, function (err, data) {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Ni najdeno'); return; }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}).listen(PORT, '0.0.0.0', function () {
  var ips = [];
  var nets = os.networkInterfaces();
  Object.keys(nets).forEach(function (k) {
    nets[k].forEach(function (n) { if (n.family === 'IPv4' && !n.internal) ips.push(n.address); });
  });
  console.log('Racuni tecejo na:');
  console.log('  http://localhost:' + PORT);
  ips.forEach(function (ip) { console.log('  http://' + ip + ':' + PORT + '   <- odpri na telefonu (ista WiFi)'); });
});

'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');

function manifest() {
  var sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'data', 'manifest.js'), 'utf8'), sandbox);
  return sandbox.window.STENCIL_MANIFEST;
}

function readJSON(rel) { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); }

module.exports = { ROOT: ROOT, manifest: manifest, readJSON: readJSON };

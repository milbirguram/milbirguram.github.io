// The Gutenberg stripper drops the header, footer and licence, and also
// tables of contents and lists of illustrations, which are not prose.
'use strict';
var assert = require('assert');
var path = require('path');
var H = require('./helpers');

var book = [
  'The Project Gutenberg eBook of A Test, by A. Fixture',
  '',
  'Title: A Test',
  '',
  'Author: A. Fixture',
  '',
  '*** START OF THE PROJECT GUTENBERG EBOOK A TEST ***',
  '',
  'A Test',
  '',
  'by A. Fixture',
  '',
  'Contents',
  '',
  ' CHAPTER I.     The Mill Road',
  ' CHAPTER II.    A Cold Night',
  ' CHAPTER III.   Morning',
  '',
  'Book the Second--the Track of a Storm',
  '',
  'ILLUSTRATIONS',
  '',
  'Heading to Chapter I.                                   1',
  '',
  '"He came down to see the place"                         2',
  '',
  'CHAPTER I.',
  'The Mill Road',
  '',
  'The morning was cold and grey, and the road to the mill was wet with',
  'rain. He walked along it with his hands in his pockets.',
  '',
  'Later in the book the word contents appears in prose, and a list of',
  'the contents of a drawer is still prose, so it stays.',
  '',
  '*** END OF THE PROJECT GUTENBERG EBOOK A TEST ***',
  '',
  'Licence text that must go.'
].join('\n');

var code = [
  'import importlib.util, json, sys',
  'spec = importlib.util.spec_from_file_location("bm", sys.argv[1])',
  'bm = importlib.util.module_from_spec(spec); spec.loader.exec_module(bm)',
  'body, meta = bm.strip_gutenberg(sys.stdin.read())',
  'sys.stdout.write(json.dumps({"body": body, "meta": meta}))'
].join('\n');

var out = JSON.parse(H.python(['-c', code, path.join(H.ROOT, 'build', 'build_model.py')], book));
var body = out.body;
assert.strictEqual(out.meta.title, 'A Test');
['Contents', 'CHAPTER II.', 'A Cold Night', 'Track of a Storm', 'ILLUSTRATIONS', 'Heading to Chapter', 'see the place',
  'Licence text', 'GUTENBERG'].forEach(function (s) {
  assert.ok(body.indexOf(s) < 0, 'should have been stripped: ' + s);
});
['The morning was cold and grey', 'the contents of a drawer is still prose', 'by A. Fixture'].forEach(function (s) {
  assert.ok(body.indexOf(s) >= 0, 'should have been kept: ' + s);
});
console.log('strip: ok');

'use strict';const fs=require('fs'),path=require('path'),M=require('../model'),root=path.join(__dirname,'..'),input=JSON.parse(fs.readFileSync(path.join(root,'data/input.json'),'utf8'));

const validation=M.validate(input.skaters);input.priors=validation.priors;input.validation=validation;

fs.writeFileSync(path.join(root,'data.js'),'var LineupData = '+JSON.stringify(input)+';\n');

fs.writeFileSync(path.join(root,'tests/validation.json'),JSON.stringify(validation,null,2)+'\n');

console.log(JSON.stringify({eligible:M.prepare(input).players.length,priors:validation.priors,validation},null,2));

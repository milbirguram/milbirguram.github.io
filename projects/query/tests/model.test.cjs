const assert=require('assert'),fs=require('fs'),vm=require('vm'),path=require('path');
const M=require('../model.js'),scope={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../data.js'),'utf8'),scope);const D=JSON.parse(JSON.stringify(scope.QueryData));
(async()=>{let checks=0;function test(fn){fn();checks++;}
test(()=>assert.equal(D.rows.length,344));
for(const b of D.batches){test(()=>assert.deepStrictEqual(b.rows.map(r=>r.id).sort(),D.cases.map(c=>c.id).sort()));for(const r of b.rows)if(r.kind==='sql')test(()=>assert.equal(M.safeSQL(r.sql),r.sql));}
for(const sql of ['DELETE FROM penguins','SELECT 1; DROP TABLE penguins','PRAGMA writable_schema=1','SELECT load_extension(\'x\')','SELECT 1 -- comment','SELECT \'unclosed'])test(()=>assert.throws(()=>M.safeSQL(sql)));
test(()=>assert.equal(M.safeSQL("SELECT 'delete; --' AS text"),"SELECT 'delete; --' AS text"));
for(const q of ['count samples not Gentoo','count samples in 2010','average mass excluding unknown sex','percentage of male Gentoo on Biscoe','three heaviest samples'])test(()=>assert.equal(M.plan(q).kind,'clarify'));
test(()=>assert.equal(M.plan('Did Biscoe cause larger penguins?').kind,'abstain'));
const init=require('../vendor/sql-wasm.js'),SQL=await init({locateFile:f=>path.join(__dirname,'../vendor',f)}),db=new SQL.Database();db.run('CREATE TABLE penguins(id INTEGER PRIMARY KEY,species TEXT,island TEXT,bill_length_mm REAL,bill_depth_mm REAL,flipper_length_mm REAL,body_mass_g REAL,sex TEXT,year INTEGER)');let stmt=db.prepare('INSERT INTO penguins VALUES(?,?,?,?,?,?,?,?,?)');for(const row of D.rows)stmt.run(row);stmt.free();db.run('PRAGMA query_only=ON');
for(const b of D.batches)for(const r of b.rows){const c=D.cases.find(c=>c.id===r.id);if(r.kind==='sql'){const actual=db.exec(M.safeSQL(r.sql))[0].values;test(()=>assert(M.compare(actual,c.expected,c.ordered),`${b.condition}/${r.id}`));}else test(()=>assert.equal(c.kind,'abstain'));}
for(const [q,expected] of [['count samples',[[344]]],['count samples by species',[['Adelie',152],['Chinstrap',68],['Gentoo',124]]],['average body mass for Gentoo',[[5076.016260162602]]]])test(()=>assert(M.compare(db.exec(M.plan(q).sql)[0].values,expected,false)));
test(()=>assert.throws(()=>db.run('DELETE FROM penguins')));test(()=>assert(!M.compare([[343.7]],[[344]],false)));db.close();console.log('Query: '+checks+' checks passed, including all 60 captured decisions with real SQLite WASM.');
})().catch(e=>{console.error(e);process.exitCode=1;});

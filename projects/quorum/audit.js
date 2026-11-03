(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.QuorumAudit=factory();})(this,function(){
  'use strict';
  function summarize(run,caseData){const ids=new Set(caseData.queries.map(q=>q.id));const cited=new Set();let invalid=0,changed=0;run.steps.forEach((s,i)=>{(s.parsed?s.parsed.evidenceQueryIds:[]).forEach(id=>{if(ids.has(id))cited.add(id);else invalid++;});if(i&&run.mode!=='independent'&&s.parsed&&run.steps[i-1].parsed&&s.parsed.claimId!==run.steps[i-1].parsed.claimId)changed++;});return {cited:cited.size,available:ids.size,invalid:invalid,changed:changed,promptTokens:run.steps.reduce((n,s)=>n+s.usage.promptTokens,0),outputTokens:run.steps.reduce((n,s)=>n+s.usage.outputTokens,0)};}
  function claim(caseData,id){const h=caseData.hypotheses.find(h=>h.id===id);return h?h.title:'Unparseable conclusion';}
  function verdict(run,caseData){return run.final.claimId===caseData.answer.claimId?'Matches planted cause':run.final.claimId?'Does not match planted cause':'No valid conclusion';}
  return {summarize:summarize,claim:claim,verdict:verdict};
});

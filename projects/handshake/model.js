(function(root){'use strict';
function timing(e){e=e||{};var n=function(k){return Number.isFinite(e[k])?e[k]:0;},start=n('startTime'),end=n('responseEnd'),total=Math.max(0,end-start),exposed=n('requestStart')>0&&n('responseStart')>0,protocol=e.nextHopProtocol||'',h3=/^h3/.test(protocol),stages=[];
function add(id,label,a,b,note){var valid=exposed&&a>0&&b>=a;stages.push({id:id,label:label,ms:valid?b-a:null,start:valid?Math.max(0,a-start):null,state:valid?'measured':'not exposed',note:valid?(note||'Measured on this request'):'Not exposed by your browser'});}
add('dns','DNS',n('domainLookupStart'),n('domainLookupEnd'),n('domainLookupStart')===n('domainLookupEnd')?'Cached, reused or no fresh lookup':'Browser-visible lookup; resolver steps are hidden');
var cs=n('connectStart'),ce=n('connectEnd'),tls=n('secureConnectionStart');
if(h3)add('quic','QUIC',cs,ce,ce===cs?'Connection reused; no new handshake':'Transport and encryption together');else{var split=tls>=cs&&tls<=ce&&tls>0;add(split||ce===cs?'tcp':'connect',split||ce===cs?'TCP':'Connect',cs,split?tls:ce,ce===cs?'Connection reused; no new connect':split?'Connection setup, excluding TLS':'Connection setup; TCP/TLS split not exposed');
if(exposed&&ce===cs&&cs>0)stages.push({id:'tls',label:'TLS',ms:0,start:cs-start,state:'measured',note:'Connection reused; no new TLS handshake'});
else if(tls>0)add('tls','TLS',tls,ce,'Encryption handshake');
else stages.push({id:'tls',label:'TLS',ms:null,start:null,state:'not exposed',note:'Not exposed, or TLS was not used'});}
add('wait','Wait',n('requestStart'),n('responseStart'),'Request sent to first response byte; includes network and server work');add('download','Receive',n('responseStart'),end,'Response bytes arriving');
// Defensive handling of malformed or inconsistent entries: do not fabricate durations.
var sum=stages.reduce(function(a,s){return a+(s.ms||0);},0);if(sum>total+0.1){stages.forEach(function(s){s.ms=null;s.start=null;s.state='not exposed';s.note='Inconsistent browser timing';});sum=0;}
return {total:total,protocol:protocol||'not exposed',exposed:exposed,stages:stages,unattributed:Math.max(0,total-sum),connection:exposed&&cs>0?(ce===cs?'reused':'new setup observed'):'not exposed',upperBoundKm:!h3&&exposed&&cs>0&&ce>cs&&tls>cs&&tls<=ce?Math.max(0,((tls>=cs&&tls<=ce&&tls>0?tls:ce)-cs)*100):null};}
function stats(values){if(!values.length)return null;var a=values.slice().sort(function(a,b){return a-b;}),mid=Math.floor(a.length/2);return {median:a.length%2?a[mid]:(a[mid-1]+a[mid])/2,min:a[0],max:a[a.length-1],count:a.length};}
var api={timing:timing,stats:stats};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.Handshake=api;
})(typeof self!=='undefined'?self:this);
